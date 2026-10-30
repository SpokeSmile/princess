"""Single configured Groq endpoint, bounded output, no paid fallback or retries."""
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from django.conf import settings

class ProviderError(Exception):
    def __init__(self, code, message, status=503):
        super().__init__(message)
        self.code, self.public_message, self.status = code, message, status


def complete(messages):
    if not settings.GROQ_API_KEY or not settings.GROQ_MODEL:
        raise ProviderError('ai_not_configured', 'Связь с отправителем пока не настроена.')
    options = {
        'model': settings.GROQ_MODEL,
        'messages': messages,
        'temperature': .65,
        'max_tokens': settings.GROQ_MAX_TOKENS,
        'stream': False,
    }
    if settings.GROQ_MODEL.startswith('qwen/'):
        options.update(reasoning_effort='none', reasoning_format='hidden')
    payload = json.dumps(options, ensure_ascii=False).encode('utf-8')
    request = Request('https://api.groq.com/openai/v1/chat/completions', data=payload, headers={
        'Authorization': f'Bearer {settings.GROQ_API_KEY}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'DeadLetterQuest/1.0',
    }, method='POST')
    try:
        with urlopen(request, timeout=settings.GROQ_TIMEOUT) as response:
            data = json.loads(response.read(128_000).decode('utf-8'))
        content = data['choices'][0]['message']['content']
        if not isinstance(content, str) or not content.strip():
            raise ValueError('Empty response')
        return content
    except HTTPError as error:
        if error.code == 429:
            raise ProviderError('provider_rate_limit', 'Достигнут лимит Groq. Повторите запрос после обновления квоты.', 429) from None
        if error.code in (401, 403):
            raise ProviderError('provider_auth', 'Линия не отвечает: проверьте подключение ИИ на сервере.') from None
        if error.code in (400, 404):
            raise ProviderError('provider_model', 'Выбранная модель Groq недоступна. Проверьте GROQ_MODEL на сервере.') from None
        if error.code == 402:
            raise ProviderError('provider_unavailable', 'Эта модель недоступна в текущем режиме. Проверьте доступную бесплатную модель на сервере.') from None
        raise ProviderError('provider_unavailable', 'Связь с отправителем временно недоступна. Попробуйте позже.') from None
    except (TimeoutError, socket.timeout):
        raise ProviderError('provider_timeout', 'Ответ задерживается. Попробуйте ещё раз через несколько секунд.') from None
    except (URLError, ValueError, KeyError, IndexError, TypeError, UnicodeError):
        raise ProviderError('provider_unavailable', 'Связь с отправителем временно недоступна. Попробуйте позже.') from None
