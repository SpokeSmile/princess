"""Local defaults and explicit production configuration; credentials never reach the browser."""
import os
from pathlib import Path
from secrets import token_urlsafe

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR.parent

# Small .env reader: literal KEY=value entries only; no shell evaluation or interpolation.
env_file = BASE_DIR / '.env'
if env_file.is_file():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        name, value = name.strip(), value.strip()
        if name and name.replace('_', '').isalnum() and name[0].isalpha():
            if len(value) > 1 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            os.environ.setdefault(name, value)

DEBUG = os.getenv('DJANGO_DEBUG', 'true').lower() in ('1', 'true', 'yes')
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', '').strip()
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError('DJANGO_SECRET_KEY is required in production.')
    secret_file = BASE_DIR / '.local-secret'
    try:
        SECRET_KEY = secret_file.read_text().strip()
    except FileNotFoundError:
        SECRET_KEY = token_urlsafe(50)
        try:
            with secret_file.open('x') as handle:
                handle.write(SECRET_KEY)
            secret_file.chmod(0o600)
        except FileExistsError:
            SECRET_KEY = secret_file.read_text().strip()
ALLOWED_HOSTS = [value.strip() for value in os.getenv('DJANGO_ALLOWED_HOSTS', '127.0.0.1,localhost,[::1]').split(',') if value.strip()]
CSRF_TRUSTED_ORIGINS = [value.strip() for value in os.getenv('DJANGO_CSRF_TRUSTED_ORIGINS', '').split(',') if value.strip()]
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
INSTALLED_APPS = ['django.contrib.contenttypes', 'django.contrib.sessions', 'quest']
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3', 'OPTIONS': {'timeout': 20}}}
SESSION_ENGINE = 'django.contrib.sessions.backends.db'
SESSION_COOKIE_NAME = 'archive_session'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
CSRF_COOKIE_NAME = 'archive_csrf'
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_FAILURE_VIEW = 'quest.views.csrf_failure'
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'SAMEORIGIN'
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 3600
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'Europe/Moscow'
USE_TZ = True
DATA_UPLOAD_MAX_MEMORY_SIZE = 32768
MISTRAL_API_KEY = os.getenv('MISTRAL_API_KEY', '').strip()
MISTRAL_MODEL = os.getenv('MISTRAL_MODEL', 'mistral-small-latest').strip()
MISTRAL_TIMEOUT = min(max(float(os.getenv('MISTRAL_TIMEOUT', '25')), 3), 60)
MISTRAL_MAX_TOKENS = 220
CHAT_COOLDOWN_SECONDS = 2
CHAT_MAX_REQUESTS = 60
