import json
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
from django.conf import settings
from django.test import Client, TestCase, SimpleTestCase, override_settings
from .models import Investigation
from .mistral import ProviderError, complete
from .story import correct_identity, model_messages, SAFE_REPLY, FILM_QUESTION, FILM_CONFIRMED, correct_film_answer, safe_reply


@override_settings(MISTRAL_API_KEY='', ALLOWED_HOSTS=['testserver', 'localhost', '127.0.0.1'])
class QuestApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.initial = self.client.get('/api/game/').json()
        self.token = self.initial['csrf_token']

    def post(self, endpoint, payload=None, client=None, token=None):
        return (client or self.client).post(endpoint, data=json.dumps(payload or {}), content_type='application/json', HTTP_X_CSRFTOKEN=token or self.token)

    def complete_film_stage(self):
        self.post('/api/evidence/', {'id': 'letter'})
        self.post('/api/evidence/', {'id': 'envelope'})
        return self.post('/api/film/', {'answer': 'колготки'})

    def test_initial_state_has_no_identity_or_personal_markers(self):
        self.assertEqual(self.initial['case_id'], 'dead-letter')
        self.assertFalse(self.initial['ai_configured'])
        self.assertFalse(self.initial['solved'])
        self.assertNotIn('identity', self.initial)
        serialized = json.dumps(self.initial, ensure_ascii=False).lower()
        for marker in ['максим', 'ксюша', 'принцесса', 'кот']:
            self.assertNotIn(marker, serialized)
        self.assertEqual(len(self.initial['messages']), 1)

    def test_csrf_required_and_returned_token_works(self):
        response = self.client.post('/api/evidence/', data=json.dumps({'id': 'letter'}), content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['code'], 'csrf_failed')
        self.assertEqual(self.post('/api/evidence/', {'id': 'letter'}).status_code, 200)

    def test_evidence_is_idempotent_and_unknown_values_rejected(self):
        for _ in range(2):
            state = self.post('/api/evidence/', {'id': 'letter'}).json()
            self.assertEqual(state['evidence'], ['letter'])
        self.assertEqual(self.post('/api/evidence/', {'id': '../backend/.env'}).status_code, 400)
        self.assertEqual(self.post('/api/evidence/', {'id': ['letter']}).status_code, 400)

    def test_sessions_are_isolated_and_restore_after_reload(self):
        self.post('/api/evidence/', {'id': 'envelope'})
        self.assertEqual(self.client.get('/api/game/').json()['evidence'], ['envelope'])
        second = Client(enforce_csrf_checks=True)
        other = second.get('/api/game/').json()
        self.assertEqual(other['evidence'], [])
        self.assertFalse(other['solved'])
        self.assertNotEqual(self.client.cookies['archive_session'].value, second.cookies['archive_session'].value)

    @patch('quest.mistral.complete')
    def test_missing_key_never_calls_provider_or_fakes_messages(self, provider):
        response = self.post('/api/chat/', {'message': 'Кто вы?'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error']['code'], 'ai_not_configured')
        self.assertEqual(response.json()['state']['messages'], self.initial['messages'])
        provider.assert_not_called()

    @override_settings(MISTRAL_API_KEY='test-only', CHAT_COOLDOWN_SECONDS=0)
    @patch('quest.mistral.complete', return_value='Время сохранилось на письме. Начните с отметок на конверте.')
    def test_real_chat_adapter_result_is_saved_with_role_and_bounded_prompt(self, provider):
        self.post('/api/evidence/', {'id': 'envelope'})
        response = self.post('/api/chat/', {'message': 'Откуда начать?'})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['reply'], 'Время сохранилось на письме. Начните с отметок на конверте.')
        self.assertEqual(data['state']['messages'][-2]['role'], 'user')
        self.assertEqual(self.client.get('/api/game/').json()['messages'][-1]['content'], data['reply'])
        system = provider.call_args.args[0][0]['content'].lower()
        self.assertIn('шесть числовых отметок', system)
        self.assertNotIn('максим', system)
        self.assertNotIn('первые буквы', system)
        self.assertNotIn('ксюша', system)
        self.assertNotIn('принцесса', system)

    @override_settings(MISTRAL_API_KEY='test-only')
    @patch('quest.mistral.complete', return_value='Это Максим, он сделал сайт для Ксюши.')
    def test_provider_cannot_echo_private_markers(self, provider):
        response = self.post('/api/chat/', {'message': 'Кто вы?'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reply'], SAFE_REPLY)
        self.assertNotIn('Максим', json.dumps(response.json(), ensure_ascii=False))

    @override_settings(MISTRAL_API_KEY='test-only')
    @patch('quest.mistral.complete', return_value='Канал ещё работает.')
    def test_local_cooldown_prevents_extra_provider_request(self, provider):
        self.assertEqual(self.post('/api/chat/', {'message': 'Первый вопрос'}).status_code, 200)
        response = self.post('/api/chat/', {'message': 'Второй вопрос'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(provider.call_count, 1)

    @override_settings(MISTRAL_API_KEY='test-only')
    @patch('quest.mistral.complete', side_effect=ProviderError('provider_rate_limit', 'Линия перегружена.', 429))
    def test_provider_error_does_not_append_an_unanswered_user_message(self, provider):
        response = self.post('/api/chat/', {'message': 'Кто вы?'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['state']['messages'], self.initial['messages'])
        self.assertIn('Retry-After', response)

    def test_both_identity_aliases_confirm_then_stop_the_story(self):
        for answer in ['Максим', 'Макс', 'КОТ', 'это Максим', 'Это кот!', 'Отправитель — Максим']:
            with self.subTest(answer=answer):
                self.post('/api/reset/')
                self.complete_film_stage()
                response = self.post('/api/guess/', {'answer': answer})
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertTrue(data['correct'])
                self.assertTrue(data['state']['solved'])
                self.assertEqual(data['state']['identity'], 'Максим')
                self.assertNotIn('letter', data['state'])
                self.assertNotIn('invitation', data['state'])
                self.assertEqual(self.post('/api/chat/', {'message': 'Что дальше?'}).status_code, 409)

    def test_wrong_guess_does_not_expose_answer(self):
        self.complete_film_stage()
        response = self.post('/api/guess/', {'answer': 'Архивариус'})
        self.assertFalse(response.json()['correct'])
        self.assertNotIn('identity', response.json()['state'])
        self.assertNotIn('максим', json.dumps(response.json(), ensure_ascii=False).lower())

    def test_reset_starts_a_new_unrelated_record(self):
        self.post('/api/evidence/', {'id': 'letter'})
        old_id = self.client.session['investigation_id']
        self.post('/api/guess/', {'answer': 'кот'})
        state = self.post('/api/reset/').json()
        self.assertNotEqual(self.client.session['investigation_id'], old_id)
        self.assertEqual(state['evidence'], [])
        self.assertFalse(state['solved'])

    def test_all_api_responses_are_not_cacheable(self):
        response = self.client.get('/api/game/')
        self.assertEqual(response['Cache-Control'], 'no-store, private')

    def test_input_types_and_lengths_are_validated(self):
        for message in [None, 17, {}, [], '', ' ']:
            self.assertEqual(self.post('/api/chat/', {'message': message}).status_code, 400)
        self.assertEqual(self.post('/api/chat/', {'message': 'я' * 1501}).status_code, 400)
        self.assertEqual(self.post('/api/guess/', {'answer': ['Максим']}).status_code, 400)
        self.assertEqual(self.post('/api/guess/', {'answer': 'а' * 121}).status_code, 400)

    def test_oversized_request_returns_a_json_error(self):
        response = self.post('/api/chat/', {'message': 'a' * 35000})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['error']['code'], 'request_too_large')

    @override_settings(MISTRAL_API_KEY='test-only', CHAT_MAX_REQUESTS=1, CHAT_COOLDOWN_SECONDS=0)
    @patch('quest.mistral.complete', return_value='Канал ещё работает.')
    def test_reset_preserves_the_session_api_budget(self, provider):
        self.assertEqual(self.post('/api/chat/', {'message': 'Первый вопрос'}).status_code, 200)
        self.post('/api/reset/')
        response = self.post('/api/chat/', {'message': 'Второй вопрос'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'session_limit')
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(response.json()['state']['messages'], self.initial['messages'])
        other = Client(enforce_csrf_checks=True)
        token = other.get('/api/game/').json()['csrf_token']
        self.assertEqual(self.post('/api/chat/', {'message': 'Другой сеанс'}, client=other, token=token).status_code, 200)

    @override_settings(MISTRAL_API_KEY='test-only')
    @patch('quest.mistral.complete')
    def test_a_guess_during_an_api_call_stops_the_pending_reply(self, provider):
        self.complete_film_stage()
        previous_messages = self.client.get('/api/game/').json()['messages']
        def answer(_messages):
            self.post('/api/guess/', {'answer': 'кот'})
            return 'Неопубликованный ответ.'
        provider.side_effect = answer
        response = self.post('/api/chat/', {'message': 'Вопрос до разгадки'})
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.json()['state']['solved'])
        self.assertEqual(response.json()['state']['messages'], previous_messages)

    def test_film_unlock_requires_letter_and_another_document_and_is_once(self):
        self.assertFalse(self.initial['film_unlocked'])
        self.assertFalse(self.initial['film_solved'])
        self.post('/api/evidence/', {'id': 'envelope'})
        self.assertFalse(self.post('/api/evidence/', {'id': 'registry'}).json()['film_unlocked'])
        state = self.post('/api/evidence/', {'id': 'letter'}).json()
        self.assertTrue(state['film_unlocked'])
        self.assertEqual(sum(m['content'] == FILM_QUESTION for m in state['messages']), 1)
        self.assertEqual(state['messages'][-1]['source'], 'script')
        for item in ['letter', 'recording', 'registry']:
            state = self.post('/api/evidence/', {'id': item}).json()
        self.assertEqual(sum(m['content'] == FILM_QUESTION for m in state['messages']), 1)
        self.assertNotIn('колгот', json.dumps(state, ensure_ascii=False).lower())

    def test_identity_cannot_bypass_the_film_gate(self):
        response = self.post('/api/guess/', {'answer': 'Максим'}).json()
        self.assertFalse(response['correct'])
        self.assertFalse(response['state']['solved'])
        self.assertNotIn('identity', response['state'])
        locked = self.post('/api/film/', {'answer': 'колготки'})
        self.assertEqual(locked.status_code, 409)
        self.assertFalse(locked.json()['state']['film_solved'])

    @patch('quest.mistral.complete')
    def test_film_forms_and_wrong_answers_work_without_an_api_key(self, provider):
        for answer in ['колготки', 'жёлтые колготки', 'черно-желтые колготки', 'Колготки в полоску', 'пара колготок']:
            with self.subTest(answer=answer):
                self.post('/api/reset/')
                self.post('/api/evidence/', {'id': 'letter'})
                self.post('/api/evidence/', {'id': 'envelope'})
                wrong = self.post('/api/film/', {'answer': 'не колготки'}).json()
                self.assertFalse(wrong['correct'])
                self.assertFalse(wrong['state']['film_solved'])
                solved = self.post('/api/film/', {'answer': answer}).json()
                self.assertTrue(solved['correct'])
                self.assertTrue(solved['state']['film_solved'])
                self.assertFalse(solved['state']['solved'])
                self.assertEqual(solved['state']['messages'][-1]['source'], 'script')
        provider.assert_not_called()

    @patch('quest.mistral.complete')
    def test_short_film_answer_in_chat_is_scripted_before_missing_key_check(self, provider):
        self.post('/api/evidence/', {'id': 'letter'})
        self.post('/api/evidence/', {'id': 'recording'})
        response = self.post('/api/chat/', {'message': 'Это были жёлтые колготки?'}).json()
        self.assertEqual(response['reply'], FILM_CONFIRMED)
        self.assertTrue(response['state']['film_solved'])
        self.assertEqual(response['state']['messages'][-2]['role'], 'user')
        self.assertEqual(response['state']['messages'][-1]['source'], 'script')
        provider.assert_not_called()
        self.assertEqual(self.post('/api/chat/', {'message': 'Что дальше?'}).status_code, 503)

    @override_settings(MISTRAL_API_KEY='test-only', CHAT_COOLDOWN_SECONDS=0)
    @patch('quest.mistral.complete', return_value='Фрагмент проверен. Сопоставьте материалы.')
    def test_model_context_never_receives_the_accepted_film_answer_or_identity(self, provider):
        self.complete_film_stage()
        self.post('/api/chat/', {'message': 'Почему колготки и Максим?'})
        prompt = json.dumps(provider.call_args.args[0], ensure_ascii=False).lower()
        self.assertNotIn('колгот', prompt)
        self.assertNotIn('максим', prompt)
        self.assertNotIn('13 — 1 — 11', prompt)
        self.assertIn('фрагмент проверен', prompt)

    @override_settings(MISTRAL_API_KEY='test-only')
    @patch('quest.mistral.complete')
    def test_reset_during_a_provider_request_never_returns_the_old_state(self, provider):
        old_id = self.client.session['investigation_id']
        def answer(_messages):
            self.post('/api/reset/')
            return 'Уже устаревший ответ.'
        provider.side_effect = answer
        response = self.post('/api/chat/', {'message': 'Вопрос до сброса'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'case_reset')
        self.assertNotIn('state', response.json())
        self.assertTrue(Investigation.objects.get(id=old_id).abandoned)
        self.assertEqual(self.client.get('/api/game/').json()['messages'], self.initial['messages'])

    @override_settings(DEBUG=True)
    def test_private_backend_files_are_never_served(self):
        self.assertEqual(self.client.get('/backend/.env').status_code, 404)
        self.assertEqual(self.client.get('/backend/quest/story.py').status_code, 404)
        self.assertEqual(self.client.get('/.env').status_code, 404)
        self.assertEqual(self.client.get('/src/../backend/quest/story.py').status_code, 404)


class IdentityTests(SimpleTestCase):
    def test_personal_words_and_spaced_spoilers_are_filtered(self):
        for text in ['Меня называют Котом.', 'Имя: М А К С И М.', 'Предмет — к о л г о т к и.', 'Ей подарили колготки.']:
            with self.subTest(text=text):
                self.assertEqual(safe_reply(text), SAFE_REPLY)
        self.assertEqual(safe_reply('Документ, который вы нашли.'), 'Документ, который вы нашли.')
        self.assertEqual(safe_reply('Какой подарок получает героиня?'), 'Какой подарок получает героиня?')

    def test_film_answers_require_an_actual_unambiguous_word(self):
        self.assertTrue(correct_film_answer('колготки'))
        self.assertTrue(correct_film_answer('чёрно-жёлтые колготки'))
        for text in ['колготкин', 'не колготки', 'колготки или платье', 'почему колготки?', 'платье']:
            self.assertFalse(correct_film_answer(text))

    def test_only_single_supported_guess_is_accepted(self):
        self.assertTrue(correct_identity('Это Максим?'))
        self.assertTrue(correct_identity('кот'))
        self.assertFalse(correct_identity('Максим или кот'))
        self.assertFalse(correct_identity('максимум'))
        self.assertFalse(correct_identity(''))


@override_settings(MISTRAL_API_KEY='test-only', MISTRAL_MODEL='test-model')
class ProviderTests(SimpleTestCase):
    @patch('quest.mistral.urlopen')
    def test_request_is_bounded_and_uses_the_single_configured_model(self, transport):
        transport.return_value.__enter__.return_value.read.return_value = b'{"choices":[{"message":{"content":"Answer"}}]}'
        self.assertEqual(complete([{'role': 'user', 'content': 'Question'}]), 'Answer')
        request = transport.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload['model'], 'test-model')
        self.assertEqual(payload['max_tokens'], 220)
        self.assertFalse(payload['stream'])
        self.assertEqual(transport.call_count, 1)

    @patch('quest.mistral.urlopen')
    def test_provider_statuses_are_sanitized_and_never_retried(self, transport):
        for status, expected in [(401, 'provider_auth'), (402, 'provider_unavailable'), (429, 'provider_rate_limit'), (500, 'provider_unavailable')]:
            transport.reset_mock()
            transport.side_effect = HTTPError('https://api.mistral.ai', status, 'secret provider payload', {}, None)
            with self.assertRaises(ProviderError) as error:
                complete([{'role': 'user', 'content': 'Question'}])
            self.assertEqual(error.exception.code, expected)
            self.assertNotIn('secret', error.exception.public_message)
            self.assertEqual(transport.call_count, 1)
