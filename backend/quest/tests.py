import json
import re
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from django.conf import settings
from django.test import Client, TestCase, SimpleTestCase, override_settings
from .models import Investigation
from .groq import ProviderError, complete
from .story import (
    CASE_ID, SESSION_KEY, DATE_DISPLAY, DATE_CONFIRMED, MONTH_CONFIRMED,
    FILM_CONFIRMED, STAMP_CONFIRMED, YEAR_CONFIRMED, HINTS, FINAL_LETTER,
    correct_date, correct_month, correct_year, correct_film_answer,
    model_messages, safe_reply, current_task,
)


@override_settings(GROQ_API_KEY='', GROQ_MODEL='test-model', CHAT_COOLDOWN_SECONDS=0,
                   ALLOWED_HOSTS=['testserver', 'localhost', '127.0.0.1'])
class QuestApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.initial = self.client.get('/api/game/').json()
        self.token = self.initial['csrf_token']

    def post(self, endpoint, payload=None, client=None, token=None):
        return (client or self.client).post(
            endpoint, data=json.dumps(payload if payload is not None else {}),
            content_type='application/json', HTTP_X_CSRFTOKEN=token or self.token,
        )

    def game(self):
        return Investigation.objects.get(id=self.client.session[SESSION_KEY])

    def complete_stamp(self):
        self.assertTrue(self.post('/api/month/', {'answer': 'январь'}).json()['correct'])
        self.assertTrue(self.post('/api/film/', {'answer': 'колготки'}).json()['correct'])
        return self.post('/api/stamp/', {'pattern': 'stripes'})

    def test_initial_state_has_a_clear_task_without_answers_or_personal_markers(self):
        self.assertEqual(self.initial['case_id'], 'undated-letter')
        self.assertEqual(self.initial['case_id'], CASE_ID)
        self.assertFalse(self.initial['ai_configured'])
        for field in ['month_solved', 'film_solved', 'stamp_solved', 'year_solved', 'solved', 'letter_opened']:
            self.assertFalse(self.initial[field])
        self.assertEqual(self.initial['evidence'], ['envelope'])
        self.assertEqual(self.initial['current_stage'], 'month')
        self.assertIn('запись дежурного', self.initial['current_task'].lower())
        self.assertEqual(len(self.initial['messages']), 1)
        self.assertNotIn('weekday', self.initial['discoveries'])
        self.assertIsNone(self.initial['discoveries']['year'])
        self.assertIsNone(self.initial['discoveries']['reading_method'])
        self.assertNotIn('letter', self.initial)
        serialized = json.dumps(self.initial, ensure_ascii=False).lower()
        for marker in ['максим', 'ксюша', 'принцесса', '2025', 'пятниц', 'календар']:
            self.assertNotIn(marker, serialized)

    def test_csrf_required_and_returned_token_works(self):
        response = self.client.post('/api/evidence/', data=json.dumps({'id': 'registry'}), content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['code'], 'csrf_failed')
        self.assertEqual(self.post('/api/evidence/', {'id': 'registry'}).status_code, 200)

    def test_evidence_is_idempotent_and_unknown_values_rejected(self):
        for _ in range(2):
            state = self.post('/api/evidence/', {'id': 'registry'}).json()
            self.assertEqual(state['evidence'], ['envelope', 'registry'])
        for item in ['../backend/.env', 'calendars', ['registry'], None]:
            with self.subTest(item=item):
                self.assertEqual(self.post('/api/evidence/', {'id': item}).status_code, 400)

    def test_sessions_are_isolated_and_restore_after_reload(self):
        self.post('/api/month/', {'answer': '01'})
        self.post('/api/year/', {'answer': '2025'})
        restored = self.client.get('/api/game/').json()
        self.assertTrue(restored['month_solved'])
        self.assertTrue(restored['year_solved'])
        self.assertEqual(restored['discoveries']['year'], '2025')
        second = Client(enforce_csrf_checks=True)
        other = second.get('/api/game/').json()
        self.assertEqual(other['evidence'], ['envelope'])
        self.assertFalse(other['month_solved'])
        self.assertFalse(other['year_solved'])
        self.assertNotEqual(restored['run_id'], other['run_id'])
        self.assertNotEqual(self.client.cookies['archive_session'].value, second.cookies['archive_session'].value)

    @patch('quest.groq.complete')
    def test_missing_key_does_not_call_provider_or_append_a_fake_answer(self, provider):
        response = self.post('/api/chat/', {'message': 'Какой здесь сорт бумаги?'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error']['code'], 'ai_not_configured')
        self.assertEqual(response.json()['state']['messages'], self.initial['messages'])
        provider.assert_not_called()

    @override_settings(GROQ_API_KEY='test-only')
    @patch('quest.groq.complete', return_value='Посмотрите внимательнее на уже открытые материалы.')
    def test_provider_response_is_saved_with_roles_and_a_bounded_private_prompt(self, provider):
        self.post('/api/evidence/', {'id': 'registry'})
        response = self.post('/api/chat/', {'message': 'Какая здесь использована бумага?'})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['reply'], 'Посмотрите внимательнее на уже открытые материалы.')
        self.assertEqual(data['state']['messages'][-2]['role'], 'user')
        self.assertEqual(data['state']['messages'][-1]['source'], 'groq')
        self.assertEqual(self.client.get('/api/game/').json()['messages'][-1]['content'], data['reply'])
        prompt = json.dumps(provider.call_args.args[0], ensure_ascii=False).lower()
        self.assertIn('запис', prompt)
        self.assertNotRegex(prompt, r'\bмаксим\b')
        for marker in ['ксюша', 'принцесса', '10.01.2025', '2025', 'две тысячи двадцать пять']:
            self.assertNotIn(marker, prompt)

    @override_settings(GROQ_API_KEY='test-only')
    @patch('quest.groq.complete', return_value='Это Максим, он сделал сайт для Ксюши.')
    def test_provider_cannot_echo_private_markers(self, provider):
        response = self.post('/api/chat/', {'message': 'Какого цвета конверт?'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reply'], current_task(self.game()) + '.')
        self.assertNotIn('Максим', json.dumps(response.json(), ensure_ascii=False))

    @override_settings(GROQ_API_KEY='test-only', CHAT_COOLDOWN_SECONDS=2)
    @patch('quest.groq.complete', return_value='Канал ещё работает.')
    def test_local_cooldown_prevents_an_extra_provider_request(self, provider):
        self.assertEqual(self.post('/api/chat/', {'message': 'Первый вопрос'}).status_code, 200)
        response = self.post('/api/chat/', {'message': 'Второй вопрос'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'cooldown')
        self.assertEqual(provider.call_count, 1)

    @override_settings(GROQ_API_KEY='test-only')
    @patch('quest.groq.complete', side_effect=ProviderError('provider_rate_limit', 'Линия перегружена.', 429))
    def test_provider_error_does_not_append_an_unanswered_message(self, provider):
        response = self.post('/api/chat/', {'message': 'Какого цвета конверт?'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['state']['messages'], self.initial['messages'])
        self.assertIn('Retry-After', response)

    @patch('quest.groq.complete')
    def test_complete_book_cipher_chain_and_explicit_letter_opening_need_no_provider(self, provider):
        stamp = self.complete_stamp().json()
        self.assertTrue(stamp['correct'])
        self.assertEqual(stamp['reading'], '10 / СТРОКА. СЛОВО.')
        self.assertEqual(stamp['message'], STAMP_CONFIRMED)
        self.assertEqual(stamp['state']['discoveries']['day'], '10')
        self.assertEqual(stamp['state']['discoveries']['reading_method'], 'СТРОКА. СЛОВО.')
        self.assertEqual(stamp['state']['current_stage'], 'year')
        self.assertIsNone(stamp['state']['discoveries']['year'])
        year = self.post('/api/year/', {'answer': 'две тысячи двадцать пять'}).json()
        self.assertTrue(year['correct'])
        self.assertTrue(year['state']['year_solved'])
        self.assertFalse(year['state']['solved'])
        self.assertFalse(year['state']['letter_opened'])
        self.assertEqual(year['state']['discoveries']['year'], '2025')
        self.assertEqual(year['state']['current_stage'], 'date')
        self.assertIn('полную дату', year['state']['current_task'].lower())
        self.assertNotIn('letter', year['state'])
        date = self.post('/api/date/', {'answer': '10.01.2025'}).json()
        self.assertTrue(date['correct'])
        self.assertNotIn('letter', date['state'])
        opened = self.post('/api/letter/').json()
        self.assertTrue(opened['letter_opened'])
        self.assertEqual(opened['letter'], FINAL_LETTER)
        self.assertEqual(self.client.get('/api/game/').json()['letter'], FINAL_LETTER)
        self.assertEqual(self.post('/api/letter/').json()['letter'], FINAL_LETTER)
        provider.assert_not_called()

    @patch('quest.groq.complete')
    def test_month_forms_accept_supported_spellings_without_provider(self, provider):
        for answer in ['январь', 'января', '01', '1']:
            with self.subTest(answer=answer):
                self.post('/api/reset/')
                response = self.post('/api/month/', {'answer': answer}).json()
                self.assertTrue(response['correct'])
                self.assertTrue(response['state']['month_solved'])
                self.assertEqual(response['message'], MONTH_CONFIRMED)
        provider.assert_not_called()

    @patch('quest.groq.complete')
    def test_film_answer_is_flexible_and_wrong_answer_preserves_discoveries(self, provider):
        for answer in ['колготки', 'чёрно-жёлтые колготки', 'Колготки в полоску', 'пара колготок']:
            with self.subTest(answer=answer):
                self.post('/api/reset/')
                self.post('/api/month/', {'answer': 'января'})
                wrong = self.post('/api/film/', {'answer': 'не колготки'}).json()
                self.assertFalse(wrong['correct'])
                self.assertTrue(wrong['state']['month_solved'])
                solved = self.post('/api/film/', {'answer': answer}).json()
                self.assertTrue(solved['correct'])
                self.assertTrue(solved['state']['film_solved'])
                self.assertEqual(solved['message'], FILM_CONFIRMED)
        provider.assert_not_called()

    def test_stamp_is_locked_until_the_film_answer(self):
        for endpoint, payload in [('/api/evidence/', {'id': 'stamp'}), ('/api/stamp/', {'pattern': 'stripes'})]:
            response = self.post(endpoint, payload)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['error']['code'], 'stamp_locked')
        self.post('/api/film/', {'answer': 'колготки'})
        self.assertEqual(self.post('/api/evidence/', {'id': 'stamp'}).status_code, 200)

    def test_wrong_templates_only_reveal_fragments_and_never_unlock_the_day(self):
        self.post('/api/film/', {'answer': 'колготки'})
        for pattern in ['checks', 'dots']:
            with self.subTest(pattern=pattern):
                data = self.post('/api/stamp/', {'pattern': pattern}).json()
                self.assertFalse(data['correct'])
                self.assertFalse(data['state']['stamp_solved'])
                self.assertIsNone(data['state']['discoveries']['reading_method'])
                self.assertNotEqual(data['reading'], '10 / СТРОКА. СЛОВО.')
        self.assertEqual(self.post('/api/stamp/', {'pattern': 'unknown'}).status_code, 400)

    @patch('quest.groq.complete')
    def test_year_forms_save_a_standalone_year_without_opening_the_letter(self, provider):
        for answer in ['2025', ' две  тысячи\nдвадцать\tпять ', 'ДВЕ ТЫСЯЧИ ДВАДЦАТЬ ПЯТЬ']:
            with self.subTest(answer=answer):
                self.post('/api/reset/')
                response = self.post('/api/year/', {'answer': answer}).json()
                self.assertTrue(response['correct'])
                self.assertEqual(response['message'], YEAR_CONFIRMED)
                self.assertTrue(response['state']['year_solved'])
                self.assertFalse(response['state']['solved'])
                self.assertEqual(response['state']['discoveries']['year'], '2025')
                self.assertEqual(self.client.get('/api/game/').json()['discoveries']['year'], '2025')
                self.assertEqual(self.post('/api/letter/').status_code, 409)
        provider.assert_not_called()

    def test_wrong_year_does_not_reset_findings_or_a_previously_solved_year(self):
        self.complete_stamp()
        before = self.client.get('/api/game/').json()
        for answer in ['2024', 'не 2025', '2025 или 2026', 'две тысячи двадцать шесть']:
            response = self.post('/api/year/', {'answer': answer}).json()
            self.assertFalse(response['correct'])
            self.assertEqual(response['state']['discoveries'], before['discoveries'])
            self.assertEqual(response['state']['evidence'], before['evidence'])
        self.post('/api/year/', {'answer': '2025'})
        wrong_after = self.post('/api/year/', {'answer': '2026'}).json()
        self.assertFalse(wrong_after['correct'])
        self.assertTrue(wrong_after['state']['year_solved'])
        self.assertEqual(wrong_after['state']['discoveries']['year'], '2025')

    def test_repeated_year_confirmation_is_idempotent(self):
        first = self.post('/api/year/', {'answer': '2025'}).json()['state']
        second = self.post('/api/year/', {'answer': '2025'}).json()['state']
        self.assertEqual(first['revision'], second['revision'])
        self.assertEqual(first['messages'], second['messages'])

    @patch('quest.groq.complete')
    def test_correct_full_date_is_accepted_from_the_start_in_all_supported_formats(self, provider):
        for answer in ['10.01.2025', '10/01/2025', '10012025', '10 января 2025']:
            with self.subTest(answer=answer):
                self.post('/api/reset/')
                response = self.post('/api/date/', {'answer': answer}).json()
                state = response['state']
                self.assertTrue(response['correct'])
                self.assertTrue(state['solved'])
                self.assertFalse(state['month_solved'])
                self.assertFalse(state['year_solved'])
                self.assertEqual(state['confirmed_date'], DATE_DISPLAY)
                self.assertEqual(state['discoveries']['year'], '2025')
                self.assertNotIn('letter', state)
        provider.assert_not_called()

    def test_wrong_date_and_old_identity_answers_do_not_change_progress(self):
        self.complete_stamp()
        before = self.client.get('/api/game/').json()
        for answer in ['10.01.2024', 'Максим', 'кот']:
            data = self.post('/api/guess/', {'answer': answer}).json()
            self.assertFalse(data['correct'])
            self.assertEqual(data['state']['discoveries'], before['discoveries'])
            self.assertEqual(data['state']['evidence'], before['evidence'])
            self.assertNotIn('identity', data['state'])

    @patch('quest.groq.complete')
    def test_answers_in_chat_are_scripted_without_provider(self, provider):
        for message, field, expected in [
            ('января', 'month_solved', MONTH_CONFIRMED),
            ('Это были жёлтые колготки?', 'film_solved', FILM_CONFIRMED),
            ('две тысячи двадцать пять', 'year_solved', YEAR_CONFIRMED),
            ('10.01.2025', 'solved', DATE_CONFIRMED),
        ]:
            response = self.post('/api/chat/', {'message': message})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data['reply'], expected)
            self.assertTrue(data['state'][field])
            self.assertEqual(data['state']['messages'][-2]['role'], 'user')
            self.assertEqual(data['state']['messages'][-1]['source'], 'script')
        provider.assert_not_called()

    @patch('quest.groq.complete')
    def test_what_to_do_and_film_purpose_have_concrete_scripted_answers(self, provider):
        response = self.post('/api/chat/', {'message': 'Что делать?'}).json()
        self.assertIn('запись дежурного', response['reply'].lower())
        response = self.post('/api/chat/', {'message': 'Зачем этот фильм?'}).json()
        self.assertRegex(response['reply'].lower(), r'узор|рисунок')
        self.assertNotIn('отношени', response['reply'].lower())
        provider.assert_not_called()

    def test_hint_levels_are_ordered_and_direct_help_requires_confirmation(self):
        skipped = self.post('/api/hint/', {'stage': 'year', 'level': 3, 'confirm': True})
        self.assertEqual(skipped.status_code, 409)
        self.assertEqual(skipped.json()['error']['code'], 'hint_order')
        for level in [1, 2]:
            response = self.post('/api/hint/', {'stage': 'year', 'level': level})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['hint']['text'], HINTS['year'][level - 1])
            self.assertNotIn('2025', response.json()['hint']['text'])
        unconfirmed = self.post('/api/hint/', {'stage': 'year', 'level': 3})
        self.assertEqual(unconfirmed.status_code, 409)
        self.assertEqual(unconfirmed.json()['error']['code'], 'hint_confirmation_required')
        confirmed = self.post('/api/hint/', {'stage': 'year', 'level': 3, 'confirm': True}).json()
        self.assertIn('2025', confirmed['hint']['text'])
        self.assertFalse(confirmed['state']['year_solved'])
        self.assertIsNone(confirmed['state']['discoveries']['year'])
        self.assertEqual(self.client.get('/api/game/').json()['hints']['year'], 3)

    def test_film_hint_can_supply_the_item_and_pattern_without_viewing_a_movie(self):
        for level in [1, 2, 3]:
            data = self.post('/api/hint/', {'stage': 'film', 'level': level, 'confirm': level == 3}).json()
        self.assertIn('колготки', data['hint']['text'])
        self.assertIn('полос', data['hint']['text'])
        self.assertFalse(data['state']['film_solved'])
        self.assertTrue(self.post('/api/film/', {'answer': 'колготки'}).json()['correct'])
        self.assertTrue(self.post('/api/stamp/', {'pattern': 'stripes'}).json()['correct'])

    def test_new_run_has_no_calendar_branch_or_weekday_in_any_hint(self):
        self.complete_stamp()
        for stage in ['month', 'film', 'stamp', 'year']:
            for level in [1, 2, 3]:
                data = self.post('/api/hint/', {'stage': stage, 'level': level, 'confirm': level == 3}).json()
                serialized = json.dumps(data, ensure_ascii=False).lower()
                self.assertNotIn('календар', serialized)
                self.assertNotIn('пятниц', serialized)
                self.assertNotIn('weekday', data['state']['discoveries'])

    def test_reset_starts_a_new_run_without_deleting_the_old_record(self):
        self.post('/api/year/', {'answer': '2025'})
        old_id = self.client.session[SESSION_KEY]
        state = self.post('/api/reset/').json()
        self.assertNotEqual(self.client.session[SESSION_KEY], old_id)
        self.assertEqual(state['evidence'], ['envelope'])
        self.assertFalse(state['year_solved'])
        self.assertFalse(state['solved'])
        previous = Investigation.objects.get(id=old_id)
        self.assertTrue(previous.abandoned)
        self.assertTrue(previous.year_solved)

    def test_stale_run_cannot_mutate_or_reset_the_new_investigation(self):
        old_run = self.initial['run_id']
        current = self.post('/api/reset/', {'run_id': old_run}).json()
        for endpoint in ['/api/month/', '/api/year/', '/api/reset/']:
            response = self.post(endpoint, {'run_id': old_run, 'answer': '2025'})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['error']['code'], 'case_reset')
        self.assertEqual(self.client.get('/api/game/').json()['run_id'], current['run_id'])
        self.assertFalse(self.game().abandoned)
        self.assertFalse(self.game().year_solved)
        self.assertEqual(Investigation.objects.count(), 2)

    def test_optimistic_updates_preserve_parallel_discoveries(self):
        from .views import record_answer
        month_writer = self.game()
        year_writer = self.game()
        record_answer(month_writer, 'month_solved', MONTH_CONFIRMED)
        record_answer(year_writer, 'year_solved', YEAR_CONFIRMED)
        restored = self.client.get('/api/game/').json()
        self.assertTrue(restored['month_solved'])
        self.assertTrue(restored['year_solved'])
        self.assertEqual(restored['discoveries']['year'], '2025')

    def test_legacy_saved_materials_and_messages_are_not_deleted(self):
        game = self.game()
        game.evidence = ['envelope', 'registry', 'calendars']
        game.messages.append({'role': 'user', 'content': 'Моя старая заметка о материале.'})
        game.hints = {'year': 2}
        game.save()
        restored = self.client.get('/api/game/').json()
        self.assertNotIn('calendars', restored['evidence'])
        self.assertEqual(restored['messages'][-1]['content'], 'Моя старая заметка о материале.')
        game.refresh_from_db()
        self.assertIn('calendars', game.evidence)
        self.assertEqual(game.hints['year'], 2)
        self.assertFalse(game.year_solved)

    def test_api_responses_are_private_and_never_cacheable(self):
        response = self.client.get('/api/game/')
        self.assertEqual(response['Cache-Control'], 'no-store, private')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')

    def test_input_types_lengths_methods_and_content_types_are_validated(self):
        for value in [None, 17, {}, [], '', ' ']:
            for route in ['month', 'film', 'year', 'date']:
                with self.subTest(route=route, value=value):
                    self.assertEqual(self.post(f'/api/{route}/', {'answer': value}).status_code, 400)
            self.assertEqual(self.post('/api/chat/', {'message': value}).status_code, 400)
        self.assertEqual(self.post('/api/year/', {'answer': 'я' * 101}).status_code, 400)
        self.assertEqual(self.post('/api/chat/', {'message': 'я' * 1501}).status_code, 400)
        self.assertEqual(self.client.get('/api/year/').status_code, 405)
        invalid_type = self.client.post('/api/year/', data='answer=2025', content_type='text/plain', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(invalid_type.status_code, 415)
        self.assertEqual(self.post('/api/year/', ['2025']).status_code, 400)

    def test_oversized_request_returns_a_json_error(self):
        response = self.post('/api/chat/', {'message': 'a' * 35000})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['error']['code'], 'request_too_large')

    @override_settings(GROQ_API_KEY='test-only', CHAT_MAX_REQUESTS=1)
    @patch('quest.groq.complete', return_value='Канал ещё работает.')
    def test_reset_preserves_the_session_provider_budget_but_another_session_is_independent(self, provider):
        self.assertEqual(self.post('/api/chat/', {'message': 'Первый вопрос'}).status_code, 200)
        self.post('/api/reset/')
        response = self.post('/api/chat/', {'message': 'Второй вопрос'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'session_limit')
        self.assertEqual(provider.call_count, 1)
        other = Client(enforce_csrf_checks=True)
        token = other.get('/api/game/').json()['csrf_token']
        self.assertEqual(self.post('/api/chat/', {'message': 'Другой сеанс'}, client=other, token=token).status_code, 200)

    @override_settings(GROQ_API_KEY='test-only')
    @patch('quest.groq.complete')
    def test_a_date_answer_during_a_provider_call_keeps_the_answer_but_discards_pending_reply(self, provider):
        def answer(_messages):
            self.post('/api/date/', {'answer': DATE_DISPLAY})
            return 'Неопубликованный ответ.'
        provider.side_effect = answer
        response = self.post('/api/chat/', {'message': 'Какого цвета конверт?'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'date_restored')
        self.assertTrue(response.json()['state']['solved'])
        self.assertEqual(response.json()['state']['messages'][-1]['content'], DATE_CONFIRMED)
        self.assertNotIn('Неопубликованный ответ.', json.dumps(response.json(), ensure_ascii=False))

    @override_settings(GROQ_API_KEY='test-only')
    @patch('quest.groq.complete')
    def test_reset_during_provider_request_never_returns_or_saves_the_old_reply(self, provider):
        old_id = self.client.session[SESSION_KEY]
        def answer(_messages):
            self.post('/api/reset/')
            return 'Уже устаревший ответ.'
        provider.side_effect = answer
        response = self.post('/api/chat/', {'message': 'Какого цвета конверт?'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'case_reset')
        self.assertNotIn('state', response.json())
        self.assertTrue(Investigation.objects.get(id=old_id).abandoned)
        self.assertEqual(self.client.get('/api/game/').json()['messages'], self.initial['messages'])

    @override_settings(DEBUG=True)
    def test_private_backend_files_are_never_served(self):
        for path in ['/backend/.env', '/backend/quest/story.py', '/.env', '/src/../backend/quest/story.py']:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)


class ScenarioRulesTests(SimpleTestCase):
    def test_shared_document_acrostic_and_coordinates_yield_the_intended_words(self):
        data = json.loads((settings.FRONTEND_DIR / 'public/data/book-cipher.json').read_text())
        lines = data['registry_lines']
        self.assertEqual(len(lines), 6)
        self.assertEqual(''.join(line[0] for line in lines), 'ЯНВАРЯ')
        self.assertEqual(data['cipher_pairs'], [[5, 6], [3, 4], [2, 9], [1, 6]])
        tokens = [re.findall(r'[А-Яа-яЁёA-Za-z0-9]+', line) for line in lines]
        decoded = [tokens[row - 1][word - 1] for row, word in data['cipher_pairs']]
        self.assertEqual(decoded, ['две', 'тысячи', 'двадцать', 'пять'])
        self.assertTrue(correct_year(' '.join(decoded)))

    def test_year_requires_a_single_supported_unambiguous_value(self):
        for text in ['2025', ' две тысячи двадцать пять ', 'ДВЕ\nТЫСЯЧИ  ДВАДЦАТЬ\tПЯТЬ']:
            self.assertTrue(correct_year(text))
        for text in ['', 'не 2025', '2025 или 2026', '2025/2026', 'двадцать пять', 'не две тысячи двадцать пять', '2024', '20250']:
            self.assertFalse(correct_year(text), text)

    def test_month_and_film_checks_remain_flexible_but_unambiguous(self):
        for text in ['январь', 'ЯНВАРЯ', '01', '1']:
            self.assertTrue(correct_month(text))
        for text in ['колготки', 'чёрно-жёлтые колготки', 'пара колготок']:
            self.assertTrue(correct_film_answer(text))
        for text in ['колготкин', 'не колготки', 'колготки или платье', 'почему колготки?', 'платье']:
            self.assertFalse(correct_film_answer(text))

    def test_full_date_checker_does_not_accept_the_year_alone_or_alternatives(self):
        for text in ['2025', '10.01.2024', 'не 10.01.2025', '10.01.2025 или 10.01.2026']:
            self.assertFalse(correct_date(text))

    def test_private_words_and_obfuscated_names_are_filtered(self):
        game = Investigation()
        for text in ['Меня называют Котом.', 'Имя: М А К С И М.', 'Это подарок для Ксюши.', 'И я тебя люблю.']:
            with self.subTest(text=text):
                self.assertEqual(safe_reply(text, game), current_task(game) + '.')
        self.assertEqual(safe_reply('Документ, который вы нашли.', game), 'Документ, который вы нашли.')

    def test_unknown_year_is_not_given_to_the_model_or_returned_by_it(self):
        game = Investigation(evidence=['envelope', 'registry', 'film', 'stamp'], month_solved=True, film_solved=True, stamp_solved=True)
        for value in ['Год — 2025.', 'Получаются две тысячи двадцать пять.']:
            self.assertEqual(safe_reply(value, game), current_task(game) + '.')
        prompt = json.dumps(model_messages(game, 'Может это 2025 или две тысячи двадцать пять?'), ensure_ascii=False).lower()
        self.assertNotIn('2025', prompt)
        self.assertNotIn('две тысячи двадцать пять', prompt)
        self.assertNotIn('10.01.2025', prompt)
        self.assertNotIn('календар', prompt)
        self.assertNotIn('пятниц', prompt)

    def test_solved_year_and_direct_hint_allow_discussion_of_year_but_never_the_full_date(self):
        for game in [Investigation(year_solved=True), Investigation(hints={'year': 3})]:
            with self.subTest(year_solved=game.year_solved):
                self.assertEqual(safe_reply('Установлен год 2025.', game), 'Установлен год 2025.')
                prompt = json.dumps(model_messages(game, 'Что известно о годе?'), ensure_ascii=False)
                self.assertIn('2025', prompt)
                self.assertNotIn('10.01.2025', prompt)
                self.assertNotEqual(safe_reply('Полная дата — 10.01.2025.', game), 'Полная дата — 10.01.2025.')
        game = Investigation(year_solved=True, solved=True)
        self.assertNotEqual(safe_reply('Полная дата — 10.01.2025.', game), 'Полная дата — 10.01.2025.')

    def test_no_personal_letter_content_is_passed_to_the_model_even_after_opening(self):
        game = Investigation(year_solved=True, solved=True, letter_opened=True, messages=[
            {'role': 'user', 'content': 'Максим сделал это для Ксюши. Наша дата 10.01.2025.'},
        ])
        prompt = json.dumps(model_messages(game, 'Для кого этот сайт?'), ensure_ascii=False).lower()
        self.assertNotRegex(prompt, r'\bмаксим\b')
        for marker in ['ксюша', 'принцесса', '10.01.2025', 'мы начали встречаться']:
            self.assertNotIn(marker, prompt)
@override_settings(GROQ_API_KEY='test-only', GROQ_MODEL='test-model')
class ProviderTests(SimpleTestCase):
    @patch('quest.groq.urlopen')
    def test_request_is_bounded_and_uses_the_single_configured_model(self, transport):
        transport.return_value.__enter__.return_value.read.return_value = b'{"choices":[{"message":{"content":"Answer"}}]}'
        self.assertEqual(complete([{'role': 'user', 'content': 'Question'}]), 'Answer')
        request = transport.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, 'https://api.groq.com/openai/v1/chat/completions')
        self.assertEqual(payload['model'], 'test-model')
        self.assertEqual(payload['max_tokens'], 220)
        self.assertFalse(payload['stream'])
        self.assertEqual(transport.call_count, 1)

    @patch('quest.groq.urlopen')
    def test_provider_statuses_are_sanitized_and_never_retried(self, transport):
        for status, expected in [(400, 'provider_model'), (401, 'provider_auth'), (402, 'provider_unavailable'), (404, 'provider_model'), (429, 'provider_rate_limit'), (500, 'provider_unavailable')]:
            transport.reset_mock()
            transport.side_effect = HTTPError('https://api.groq.com', status, 'secret provider payload', {}, None)
            with self.assertRaises(ProviderError) as error:
                complete([{'role': 'user', 'content': 'Question'}])
            self.assertEqual(error.exception.code, expected)
            self.assertNotIn('secret', error.exception.public_message)
            self.assertEqual(transport.call_count, 1)


class DeploymentConfigurationTests(SimpleTestCase):
    def test_postgres_url_preserves_escaped_credentials_and_tls_options(self):
        from pathlib import Path
        from config.database import database_config
        db = database_config('postgresql://test%40user:p%3Ass%2Fword@demo-pooler.example/db?sslmode=require&channel_binding=require', Path('/tmp'))
        self.assertEqual(db['ENGINE'], 'django.db.backends.postgresql')
        self.assertEqual(db['USER'], 'test@user')
        self.assertEqual(db['PASSWORD'], 'p:ss/word')
        self.assertEqual(db['HOST'], 'demo-pooler.example')
        self.assertEqual(db['OPTIONS']['sslmode'], 'require')
        self.assertEqual(db['OPTIONS']['channel_binding'], 'require')
        self.assertEqual(db['CONN_MAX_AGE'], 0)

    def test_vercel_never_silently_uses_sqlite(self):
        from pathlib import Path
        from django.core.exceptions import ImproperlyConfigured
        from config.database import database_config
        with self.assertRaises(ImproperlyConfigured):
            database_config('', Path('/tmp'), require_external=True)
        with self.assertRaisesMessage(ImproperlyConfigured, 'valid PostgreSQL'):
            database_config('mysql://secret:password@host/db', Path('/tmp'))
        self.assertEqual(database_config('', Path('/tmp'))['ENGINE'], 'django.db.backends.sqlite3')

    @override_settings(GROQ_API_KEY='test-only', GROQ_MODEL='qwen/qwen3.8-27b')
    @patch('quest.groq.urlopen')
    def test_chat_model_returns_only_visible_answer_without_reasoning(self, transport):
        transport.return_value.__enter__.return_value.read.return_value = b'{"choices":[{"message":{"content":"Answer"}}]}'
        complete([{'role': 'user', 'content': 'Question'}])
        payload = json.loads(transport.call_args.args[0].data)
        self.assertEqual(payload['reasoning_effort'], 'none')
        self.assertEqual(payload['reasoning_format'], 'hidden')
