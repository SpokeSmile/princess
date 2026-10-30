import json
import re
import time
from functools import wraps
from pathlib import Path
from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.db.models import F
from django.http import FileResponse, JsonResponse, Http404
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from .models import Investigation, ChannelBudget
from . import groq
from .story import (
    CASE_ID, SESSION_KEY, GREETING, DATE_DISPLAY, DATE_CONFIRMED,
    MONTH_CONFIRMED, FILM_CONFIRMED, STAMP_CONFIRMED, YEAR_CONFIRMED, EVIDENCE_FACTS,
    HINTS, FINAL_LETTER, correct_date, date_candidate, correct_month, correct_year,
    correct_film_answer, current_stage, current_task, normalize, safe_reply,
    model_messages,
)


class CaseReset(Exception):
    pass


class BusyState(Exception):
    pass


def investigation_for(request):
    game_id = request.session.get(SESSION_KEY)
    investigation = Investigation.objects.filter(id=game_id).first() if game_id else None
    if investigation is not None and investigation.abandoned:
        raise CaseReset
    expected_run = getattr(request, 'data', {}).get('run_id') if request.method == 'POST' else None
    if expected_run and (investigation is None or str(investigation.id) != expected_run):
        raise CaseReset
    if investigation is None:
        investigation = Investigation.objects.create(
            evidence=['envelope'],
            messages=[{'role': 'assistant', 'content': GREETING, 'source': 'script'}],
        )
        request.session[SESSION_KEY] = str(investigation.id)
    return investigation


def channel_budget_for(request):
    budget_id = request.session.get('channel_budget_id')
    budget = ChannelBudget.objects.filter(id=budget_id).first() if budget_id else None
    if budget is None:
        budget = ChannelBudget.objects.create()
        request.session['channel_budget_id'] = str(budget.id)
    return budget


def hint_log(investigation):
    return [
        {'stage': stage, 'level': level, 'text': texts[level - 1]}
        for stage, texts in HINTS.items()
        for level in range(1, min(int(investigation.hints.get(stage, 0)), 3) + 1)
    ]


def public_state(request, investigation):
    result = {
        'case_id': CASE_ID,
        'run_id': str(investigation.id),
        'revision': investigation.revision,
        'messages': investigation.messages,
        'evidence': [item for item in investigation.evidence if item in EVIDENCE_FACTS],
        'solved': investigation.solved,
        'month_solved': investigation.month_solved,
        'film_unlocked': True,
        'film_solved': investigation.film_solved,
        'stamp_solved': investigation.stamp_solved,
        'year_solved': investigation.year_solved,
        'letter_opened': investigation.letter_opened,
        'hints': investigation.hints,
        'hint_log': hint_log(investigation),
        'current_stage': current_stage(investigation),
        'current_task': current_task(investigation),
        'discoveries': {
            'month': 'январь / 01' if investigation.month_solved else None,
            'day': '10' if investigation.stamp_solved else None,
            'year': '2025' if investigation.year_solved or investigation.solved else None,
            'reading_method': 'СТРОКА. СЛОВО.' if investigation.stamp_solved else None,
        },
        'confirmed_date': DATE_DISPLAY if investigation.solved else None,
        'ai_configured': bool(settings.GROQ_API_KEY and settings.GROQ_MODEL),
        'csrf_token': get_token(request),
    }
    # No personal words or the letter body are delivered before this explicit action.
    if investigation.letter_opened:
        result['letter'] = FINAL_LETTER
    return result


def respond(data, status=200):
    response = JsonResponse(data, status=status, json_dumps_params={'ensure_ascii': False})
    response['Cache-Control'] = 'no-store, private'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


def failure(code, message, status=400, state=None):
    data = {'error': {'code': code, 'message': message}}
    if state is not None:
        data['state'] = state
    response = respond(data, status)
    if status == 429:
        response['Retry-After'] = '3' if code == 'cooldown' else '60'
    return response


def stale_case():
    return failure('case_reset', 'Расследование было начато заново. Обновите страницу.', 409)


def api(method):
    def decorate(view):
        @wraps(view)
        def wrapped(request):
            if request.method != method:
                response = failure('method_not_allowed', 'Этот способ запроса не поддерживается.', 405)
                response['Allow'] = method
                return response
            if method == 'POST':
                if request.content_type != 'application/json':
                    return failure('invalid_content_type', 'Ожидается JSON-запрос.', 415)
                try:
                    if len(request.body) > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
                        return failure('request_too_large', 'Запрос слишком большой.', 413)
                    request.data = json.loads(request.body or b'{}')
                except RequestDataTooBig:
                    return failure('request_too_large', 'Запрос слишком большой.', 413)
                except (ValueError, UnicodeError):
                    return failure('invalid_json', 'Не удалось прочитать запрос.')
                if not isinstance(request.data, dict):
                    return failure('invalid_json', 'Ожидается объект JSON.')
            try:
                return view(request)
            except CaseReset:
                return stale_case()
            except BusyState:
                return failure('request_in_progress', 'Материалы обновляются. Повторите действие.', 409)
        return wrapped
    return decorate


def mutate(investigation, changes):
    """Versioned optimistic writes preserve parallel discoveries on SQLite and PostgreSQL."""
    for _ in range(24):
        if investigation.abandoned:
            raise CaseReset
        patch = changes(investigation)
        if not patch:
            return investigation
        saved = Investigation.objects.filter(
            id=investigation.id, revision=investigation.revision, abandoned=False,
        ).update(**patch, revision=F('revision') + 1, updated_at=timezone.now())
        investigation.refresh_from_db()
        if investigation.abandoned:
            raise CaseReset
        if saved:
            return investigation
    raise BusyState


def appended(investigation, reply, user_message=None, source='script'):
    additions = ([{'role': 'user', 'content': user_message}] if user_message else [])
    return [*investigation.messages, *additions, {'role': 'assistant', 'content': reply, 'source': source}][-41:]


def record_answer(investigation, field, message, *, user_message=None, evidence_id=None):
    def changes(current):
        if getattr(current, field):
            if user_message:
                reply = message(current) if callable(message) else message
                return {'messages': appended(current, reply, user_message)}
            return {}
        patch = {field: True, 'messages': appended(current, message(current) if callable(message) else message, user_message)}
        if evidence_id and evidence_id not in current.evidence:
            patch['evidence'] = [*current.evidence, evidence_id]
        return patch
    return mutate(investigation, changes)


def stamp_message(investigation):
    return STAMP_CONFIRMED


def answer_value(request, *, limit=240):
    value = request.data.get('answer')
    return value.strip() if isinstance(value, str) and value.strip() and len(value) <= limit else None


def answer_result(request, investigation, correct, message, **extra):
    return respond({'correct': correct, 'message': message, 'state': public_state(request, investigation), **extra})


@ensure_csrf_cookie
@api('GET')
def game(request):
    channel_budget_for(request)
    return respond(public_state(request, investigation_for(request)))


@api('POST')
def evidence(request):
    item = request.data.get('id')
    if not isinstance(item, str) or item not in EVIDENCE_FACTS:
        return failure('unknown_evidence', 'Такого материала в деле нет.')
    investigation = investigation_for(request)
    if item == 'stamp' and not investigation.film_solved:
        return failure('stamp_locked', 'Сначала установите предмет из кинофрагмента.', 409, public_state(request, investigation))
    mutate(investigation, lambda current: {'evidence': [*current.evidence, item]} if item not in current.evidence else {})
    return respond(public_state(request, investigation))


@api('POST')
def month(request):
    answer = answer_value(request)
    if answer is None:
        return failure('invalid_answer', 'Впишите название или номер месяца.')
    investigation = investigation_for(request)
    correct = correct_month(answer)
    if correct:
        record_answer(investigation, 'month_solved', MONTH_CONFIRMED, evidence_id='registry')
    return answer_result(request, investigation, correct, MONTH_CONFIRMED if correct else 'Месяц не совпал. Внимательно посмотрите на начала шести строк.')


@api('POST')
def year(request):
    answer = answer_value(request, limit=100)
    if answer is None:
        return failure('invalid_answer', 'Впишите год цифрами или словами — до 100 символов.')
    investigation = investigation_for(request)
    correct = correct_year(answer)
    if correct:
        record_answer(investigation, 'year_solved', YEAR_CONFIRMED, evidence_id='registry')
    return answer_result(request, investigation, correct, YEAR_CONFIRMED if correct else 'Год не совпал. Проверьте номера строк и слов в записи дежурного. Найденные сведения сохранены.')


@api('POST')
def film(request):
    answer = answer_value(request)
    if answer is None:
        return failure('invalid_answer', 'Назовите предмет из эпизода — до 240 символов.')
    investigation = investigation_for(request)
    correct = correct_film_answer(answer)
    if correct:
        record_answer(investigation, 'film_solved', FILM_CONFIRMED, evidence_id='film')
    return answer_result(request, investigation, correct, FILM_CONFIRMED if correct else 'Предмет не совпал. Посмотрите на подарок и его рисунок. Если фильм недоступен, используйте подсказку.')


@api('POST')
def stamp(request):
    pattern = request.data.get('pattern')
    if pattern not in ('stripes', 'checks', 'dots'):
        return failure('invalid_pattern', 'Выберите один из трёх шаблонов чтения.')
    investigation = investigation_for(request)
    correct = pattern == 'stripes'
    if not investigation.film_solved:
        return failure('stamp_locked', 'Сначала установите предмет из кинофрагмента.', 409, public_state(request, investigation))
    if correct:
        record_answer(investigation, 'stamp_solved', stamp_message, evidence_id='stamp')
    reading = {'stripes': '10 / СТРОКА. СЛОВО.', 'checks': '1· / С·····. ·····.', 'dots': '·0 / ······. ··О··.'}[pattern]
    return answer_result(request, investigation, correct, stamp_message(investigation) if correct else 'Видны только неполные фрагменты. Попробуйте другой рисунок шаблона.', reading=reading)


@api('POST')
def date_guess(request):
    answer = answer_value(request)
    if answer is None:
        return failure('invalid_answer', 'Впишите дату: день, месяц и год.')
    investigation = investigation_for(request)
    correct = correct_date(answer)
    if correct:
        record_answer(investigation, 'solved', DATE_CONFIRMED)
    return answer_result(request, investigation, correct, DATE_CONFIRMED if correct else 'Дата не совпала. Найденные части остаются в досье; сопоставьте материалы ещё раз.')


@api('POST')
def letter(request):
    investigation = investigation_for(request)
    if not investigation.solved:
        return failure('letter_locked', 'Сначала восстановите дату, чтобы открыть конверт.', 409, public_state(request, investigation))
    mutate(investigation, lambda current: {'letter_opened': True} if not current.letter_opened else {})
    return respond(public_state(request, investigation))


@api('POST')
def hint(request):
    stage = request.data.get('stage')
    level = request.data.get('level')
    if not isinstance(stage, str) or stage not in HINTS or type(level) is not int or not 1 <= level <= 3:
        return failure('invalid_hint', 'Выберите этап и уровень подсказки от 1 до 3.')
    investigation = investigation_for(request)
    current_level = int(investigation.hints.get(stage, 0))
    if level > current_level + 1:
        return failure('hint_order', 'Сначала откройте предыдущую подсказку.', 409, public_state(request, investigation))
    if level == 3 and current_level < 3 and request.data.get('confirm') is not True:
        return failure('hint_confirmation_required', 'Эта подсказка содержит прямую помощь с решением. Подтвердите её открытие.', 409, public_state(request, investigation))
    def changes(current):
        levels = dict(current.hints)
        if levels.get(stage, 0) >= level:
            return {}
        if level > levels.get(stage, 0) + 1:
            raise BusyState
        levels[stage] = level
        return {'hints': levels}
    mutate(investigation, changes)
    item = {'stage': stage, 'level': level, 'text': HINTS[stage][level - 1]}
    return respond({'hint': item, 'state': public_state(request, investigation)})


def script_reply(investigation, message):
    text = normalize(message)
    if date_candidate(message) is not None:
        if correct_date(message):
            record_answer(investigation, 'solved', DATE_CONFIRMED, user_message=message)
            return DATE_CONFIRMED
        reply = 'Дата не совпала. Найденные части остаются в досье. ' + current_task(investigation) + '.'
    elif correct_month(message):
        record_answer(investigation, 'month_solved', MONTH_CONFIRMED, user_message=message, evidence_id='registry')
        return MONTH_CONFIRMED
    elif correct_year(message):
        record_answer(investigation, 'year_solved', YEAR_CONFIRMED, user_message=message, evidence_id='registry')
        return YEAR_CONFIRMED
    elif re.fullmatch(r'\d{4}', text):
        reply = 'Год не совпал. Проверьте пары на конверте и слова записи дежурного. ' + current_task(investigation) + '.'
    elif correct_film_answer(message):
        record_answer(investigation, 'film_solved', FILM_CONFIRMED, user_message=message, evidence_id='film')
        return FILM_CONFIRMED
    elif re.search(r'что.{0,25}(?:делать|дальше)|с чего.{0,15}начать|какой.{0,15}следующий.{0,10}шаг', text):
        reply = current_task(investigation) + '.'
    elif re.search(r'зачем|почему|для чего|к чему', text) and re.search(r'фильм|эпизод|сцен', text):
        reply = 'Рисунок на предмете подсказывает, какой шаблон приложить к повреждённому оттиску. Тёмные участки закрывают лишнюю печать, светлые сохраняют исходную запись.'
    elif re.search(r'зачем|почему|для чего', text) and re.search(r'дат|день', text):
        reply = 'Я намеренно оставил следы этого дня. Почему он важен, объясняется внутри конверта. ' + current_task(investigation) + '.'
    elif re.search(r'шифр|пары|строка.{0,6}слово|считать слова|номер слова', text):
        if investigation.stamp_solved or investigation.hints.get('stamp', 0) >= 3 or investigation.hints.get('year', 0) >= 2:
            reply = 'Первая цифра пары — номер строки записи дежурного, вторая — номер слова. Считайте с единицы: предлоги — отдельные слова, знаки препинания пропускайте. Переносы текста на экране не добавляют новых строк.'
        else:
            reply = 'Назначение пар пока не установлено. Сначала прочитайте оттиск. ' + current_task(investigation) + '.'
    elif re.search(r'кто ты|кто вы|твое имя|тебя зовут|вас зовут|кто (?:создал|сделал|отправил)', text):
        reply = 'Я подготовил это расследование и оставил конверт. Имя прочитаете в письме, когда восстановите дату.'
    elif investigation.solved:
        reply = 'Дата восстановлена. Можно открыть письмо или продолжить изучать материалы.' if not investigation.letter_opened else 'Письмо остаётся в вашем досье. Можно перечитать его или вернуться к материалам расследования.'
    else:
        return None
    mutate(investigation, lambda current: {'messages': appended(current, reply, message)})
    return reply


@api('POST')
def chat(request):
    message = request.data.get('message')
    if not isinstance(message, str) or not message.strip():
        return failure('empty_message', 'Напишите вопрос отправителю.')
    message = message.strip()
    if len(message) > 1500:
        return failure('message_too_long', 'Вопрос должен быть не длиннее 1500 символов.')
    investigation = investigation_for(request)
    reply = script_reply(investigation, message)
    if reply is not None:
        return respond({'reply': reply, 'state': public_state(request, investigation)})
    state = public_state(request, investigation)
    if not settings.GROQ_API_KEY or not settings.GROQ_MODEL:
        return failure('ai_not_configured', 'Связь с отправителем пока не настроена.', 503, state)
    budget = channel_budget_for(request)
    now = time.time()
    if budget.request_count >= settings.CHAT_MAX_REQUESTS:
        return failure('session_limit', 'Для этого сеанса достигнут лимит вопросов. Все материалы, подсказки и проверки остаются доступны.', 429, state)
    if budget.busy_until > now:
        return failure('request_in_progress', 'Дождитесь ответа на предыдущий вопрос.', 429, state)
    if now - budget.last_request_at < settings.CHAT_COOLDOWN_SECONDS:
        return failure('cooldown', 'Между вопросами нужна небольшая пауза.', 429, state)
    claimed = ChannelBudget.objects.filter(
        id=budget.id, busy_until__lte=now,
        last_request_at__lte=now-settings.CHAT_COOLDOWN_SECONDS,
        request_count__lt=settings.CHAT_MAX_REQUESTS,
    ).update(busy_until=now+settings.GROQ_TIMEOUT+5, last_request_at=now, request_count=F('request_count')+1)
    if not claimed:
        return failure('request_in_progress', 'Дождитесь ответа на предыдущий вопрос.', 429, state)
    try:
        reply = safe_reply(groq.complete(model_messages(investigation, message)), investigation)
        if not reply:
            raise groq.ProviderError('provider_unavailable', 'Ответ не удалось разобрать. Попробуйте ещё раз.')
        def changes(current):
            if current.solved:
                return {}
            return {'messages': appended(current, reply, message, source='groq'), 'chat_count': F('chat_count') + 1}
        mutate(investigation, changes)
        if investigation.solved:
            return failure('date_restored', 'Дата уже восстановлена. Можно открыть письмо или вернуться к материалам.', 409, public_state(request, investigation))
        return respond({'reply': reply, 'state': public_state(request, investigation)})
    except groq.ProviderError as error:
        investigation.refresh_from_db()
        if investigation.abandoned:
            raise CaseReset
        return failure(error.code, error.public_message, error.status, public_state(request, investigation))
    finally:
        ChannelBudget.objects.filter(id=budget.id).update(busy_until=0)


@api('POST')
def reset(request):
    # Validate the supplied run before closing it. A stale reset must not close
    # the current investigation or create another replacement record.
    previous = investigation_for(request)
    closed = Investigation.objects.filter(id=previous.id, abandoned=False).update(
        abandoned=True, revision=F('revision') + 1, updated_at=timezone.now(),
    )
    if not closed:
        raise CaseReset
    request.session.pop(SESSION_KEY, None)
    # The old run was checked above; it must not guard creation of the new run.
    request.data.pop('run_id', None)
    return respond(public_state(request, investigation_for(request)))


def csrf_failure(request, reason=''):
    return failure('csrf_failed', 'Сеанс проверки устарел. Обновите страницу и попробуйте ещё раз.', 403)


def frontend(request):
    if request.method not in ('GET', 'HEAD'):
        return failure('method_not_allowed', 'Этот способ запроса не поддерживается.', 405)
    file_path = Path(settings.FRONTEND_DIR) / 'index.html'
    if not file_path.is_file():
        raise Http404
    response = FileResponse(file_path.open('rb'), content_type='text/html; charset=utf-8')
    response['Cache-Control'] = 'no-cache'
    return response
