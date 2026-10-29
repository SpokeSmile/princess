import json
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
from . import mistral
from .story import (CASE_ID, GREETING, SOLVED_MESSAGE, EVIDENCE_FACTS,
                    FILM_QUESTION, FILM_CONFIRMED, correct_film_answer,
                    correct_identity, safe_reply, model_messages)


def investigation_for(request):
    game_id = request.session.get('investigation_id')
    game = Investigation.objects.filter(id=game_id).first() if game_id else None
    if game is None or game.abandoned:
        game = Investigation.objects.create(messages=[{'role': 'assistant', 'content': GREETING, 'source': 'script'}])
        request.session['investigation_id'] = str(game.id)
    return game


def channel_budget_for(request):
    budget_id = request.session.get('channel_budget_id')
    budget = ChannelBudget.objects.filter(id=budget_id).first() if budget_id else None
    if budget is None:
        budget = ChannelBudget.objects.create()
        request.session['channel_budget_id'] = str(budget.id)
    return budget


def public_state(request, game):
    result = {
        'case_id': CASE_ID,
        'messages': game.messages,
        'evidence': game.evidence,
        'solved': game.solved,
        'film_unlocked': game.film_unlocked,
        'film_solved': game.film_solved,
        'ai_configured': bool(settings.MISTRAL_API_KEY and settings.MISTRAL_MODEL),
        'csrf_token': get_token(request),
    }
    if game.solved:
        result.update(identity='Максим', message=SOLVED_MESSAGE)
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
    # Never return an old investigation after reset, even to an in-flight request.
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
            return view(request)
        return wrapped
    return decorate


@ensure_csrf_cookie
@api('GET')
def game(request):
    # Establish the shared budget before the browser can issue concurrent POSTs.
    channel_budget_for(request)
    return respond(public_state(request, investigation_for(request)))


@api('POST')
def evidence(request):
    item = request.data.get('id')
    if not isinstance(item, str) or item not in EVIDENCE_FACTS:
        return failure('unknown_evidence', 'Такого материала в деле нет.')
    investigation = investigation_for(request)
    for _ in range(16):
        if investigation.abandoned:
            return stale_case()
        if investigation.solved or item in investigation.evidence:
            return respond(public_state(request, investigation))
        new_evidence = [*investigation.evidence, item]
        unlock = not investigation.film_unlocked and 'letter' in new_evidence and len(new_evidence) >= 2
        messages = investigation.messages
        if unlock:
            messages = [*messages, {'role': 'assistant', 'content': FILM_QUESTION, 'source': 'script'}]
        # Optimistic merge protects both found documents and the one-time script
        # from parallel evidence/chat requests on SQLite and multiple workers.
        saved = Investigation.objects.filter(
            id=investigation.id, evidence=investigation.evidence,
            messages=investigation.messages, film_unlocked=investigation.film_unlocked,
            solved=False, abandoned=False,
        ).update(evidence=new_evidence, messages=messages,
                 film_unlocked=investigation.film_unlocked or unlock, updated_at=timezone.now())
        investigation.refresh_from_db()
        if saved:
            return respond(public_state(request, investigation))
    return failure('request_in_progress', 'Материалы обновляются. Попробуйте ещё раз.', 409)


def record_film_answer(investigation, answer):
    for _ in range(16):
        if investigation.abandoned or investigation.solved or not investigation.film_unlocked:
            return False
        if investigation.film_solved:
            return True
        messages = [*investigation.messages,
                    {'role': 'user', 'content': answer},
                    {'role': 'assistant', 'content': FILM_CONFIRMED, 'source': 'script'}][-41:]
        saved = Investigation.objects.filter(
            id=investigation.id, messages=investigation.messages,
            film_unlocked=True, film_solved=False, solved=False, abandoned=False,
        ).update(film_solved=True, messages=messages, updated_at=timezone.now())
        investigation.refresh_from_db()
        if saved:
            return True
    return False


@api('POST')
def film(request):
    answer = request.data.get('answer')
    if not isinstance(answer, str) or not answer.strip() or len(answer) > 120:
        return failure('invalid_answer', 'Назовите предмет — до 120 символов.')
    investigation = investigation_for(request)
    if not investigation.film_unlocked:
        return failure('film_locked', 'Сначала изучите письмо и ещё один материал.', 409, public_state(request, investigation))
    if investigation.solved:
        return respond({'correct': True, 'message': SOLVED_MESSAGE, 'state': public_state(request, investigation)})
    correct = investigation.film_solved or correct_film_answer(answer)
    if correct and not investigation.film_solved:
        correct = record_film_answer(investigation, answer.strip())
    if investigation.abandoned:
        return stale_case()
    return respond({
        'correct': correct,
        'message': FILM_CONFIRMED if correct else 'Предмет не совпадает с фрагментом. Посмотрите эпизод и попробуйте ещё раз.',
        'state': public_state(request, investigation),
    })


@api('POST')
def chat(request):
    message = request.data.get('message')
    if not isinstance(message, str) or not message.strip():
        return failure('empty_message', 'Напишите вопрос отправителю.')
    message = message.strip()
    if len(message) > 1500:
        return failure('message_too_long', 'Вопрос должен быть не длиннее 1500 символов.')
    investigation = investigation_for(request)
    state = public_state(request, investigation)
    if investigation.solved:
        return failure('case_closed', 'Личность отправителя уже установлена.', 409, state)
    if investigation.film_unlocked and not investigation.film_solved and correct_film_answer(message):
        if record_film_answer(investigation, message):
            return respond({'reply': FILM_CONFIRMED, 'state': public_state(request, investigation)})
        if investigation.abandoned:
            return stale_case()
        return failure('request_in_progress', 'Материалы обновились. Повторите ответ.', 409)
    if not settings.MISTRAL_API_KEY or not settings.MISTRAL_MODEL:
        return failure('ai_not_configured', 'Связь с отправителем пока не настроена.', 503, state)
    budget = channel_budget_for(request)
    now = time.time()
    if budget.request_count >= settings.CHAT_MAX_REQUESTS:
        return failure('session_limit', 'Для этого сеанса достигнут лимит вопросов. Найденные материалы остаются доступны.', 429, state)
    if budget.busy_until > now:
        return failure('request_in_progress', 'Дождитесь ответа на предыдущий вопрос.', 429, state)
    if now - budget.last_request_at < settings.CHAT_COOLDOWN_SECONDS:
        return failure('cooldown', 'Между вопросами нужна небольшая пауза.', 429, state)
    claimed = ChannelBudget.objects.filter(
        id=budget.id, busy_until__lte=now,
        last_request_at__lte=now-settings.CHAT_COOLDOWN_SECONDS,
        request_count__lt=settings.CHAT_MAX_REQUESTS,
    ).update(busy_until=now+settings.MISTRAL_TIMEOUT+5, last_request_at=now, request_count=F('request_count')+1)
    if not claimed:
        return failure('request_in_progress', 'Дождитесь ответа на предыдущий вопрос.', 429, state)
    try:
        reply = safe_reply(mistral.complete(model_messages(investigation, message)))
        if not reply:
            raise mistral.ProviderError('provider_unavailable', 'Ответ не удалось разобрать. Попробуйте ещё раз.')
        # Preserve script messages added while Mistral was answering; never revive
        # a solved or reset investigation, even between refresh and the SQL write.
        for _ in range(16):
            investigation.refresh_from_db()
            if investigation.abandoned:
                return stale_case()
            if investigation.solved:
                return failure('case_closed', 'Личность отправителя уже установлена.', 409, public_state(request, investigation))
            messages = [*investigation.messages, {'role': 'user', 'content': message},
                        {'role': 'assistant', 'content': reply, 'source': 'mistral'}][-41:]
            saved = Investigation.objects.filter(
                id=investigation.id, messages=investigation.messages,
                solved=False, abandoned=False,
            ).update(messages=messages, chat_count=F('chat_count')+1, updated_at=timezone.now())
            if saved:
                investigation.refresh_from_db()
                return respond({'reply': reply, 'state': public_state(request, investigation)})
        return failure('request_in_progress', 'Материалы обновляются. Повторите вопрос.', 409)
    except mistral.ProviderError as error:
        investigation.refresh_from_db()
        if investigation.abandoned:
            return stale_case()
        return failure(error.code, error.public_message, error.status, public_state(request, investigation))
    finally:
        ChannelBudget.objects.filter(id=budget.id).update(busy_until=0)


@api('POST')
def guess(request):
    answer = request.data.get('answer')
    if not isinstance(answer, str) or not answer.strip() or len(answer) > 120:
        return failure('invalid_answer', 'Введите имя или позывной отправителя — до 120 символов.')
    investigation = investigation_for(request)
    if not investigation.film_solved:
        return respond({'correct': False, 'message': 'Сначала проверьте предмет из фрагмента фильма.', 'state': public_state(request, investigation)})
    correct = investigation.solved or correct_identity(answer)
    if correct and not investigation.solved:
        Investigation.objects.filter(id=investigation.id, film_solved=True, abandoned=False).update(solved=True, updated_at=timezone.now())
        investigation.refresh_from_db()
    if investigation.abandoned:
        return stale_case()
    return respond({
        'correct': correct,
        'message': SOLVED_MESSAGE if correct else 'Версия не подтверждена. Сопоставьте найденные материалы и попробуйте ещё раз.',
        'state': public_state(request, investigation),
    })


@api('POST')
def reset(request):
    old_id = request.session.get('investigation_id')
    if old_id:
        Investigation.objects.filter(id=old_id).update(abandoned=True, updated_at=timezone.now())
    request.session.pop('investigation_id', None)
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
