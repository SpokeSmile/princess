"""Local defaults and explicit production configuration; credentials never reach the browser."""
import os
from pathlib import Path
from secrets import token_urlsafe
from .database import database_config

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR.parent

# Small .env reader: literal KEY=value entries only; no shell evaluation or interpolation.
ON_VERCEL = os.getenv('VERCEL') == '1'
env_file = BASE_DIR / '.env'
if not ON_VERCEL and env_file.is_file():
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

DEBUG = os.getenv('DJANGO_DEBUG', 'false' if ON_VERCEL else 'true').lower() in ('1', 'true', 'yes')
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
if ON_VERCEL:
    for name in ('VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'):
        host = os.getenv(name, '').strip()
        if host and '/' not in host:
            ALLOWED_HOSTS.append(host)
            CSRF_TRUSTED_ORIGINS.append('https://' + host)
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'backend.config.wsgi.application' if ON_VERCEL else 'config.wsgi.application'
INSTALLED_APPS = ['django.contrib.contenttypes', 'django.contrib.sessions', 'django.contrib.staticfiles', 'quest']
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
DATABASES = {'default': database_config(os.getenv('DATABASE_URL', '').strip(), BASE_DIR, require_external=ON_VERCEL)}
STATIC_URL = '/static/'
STATIC_ROOT = FRONTEND_DIR / 'staticfiles'
STATICFILES_DIRS = [('site-src', FRONTEND_DIR / 'src'), ('site-public', FRONTEND_DIR / 'public')]
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
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '').strip()
GROQ_MODEL = os.getenv('GROQ_MODEL', 'qwen/qwen3.8-27b').strip()
GROQ_TIMEOUT = min(max(float(os.getenv('GROQ_TIMEOUT', '25')), 3), 60)
GROQ_MAX_TOKENS = 220
CHAT_COOLDOWN_SECONDS = 2
CHAT_MAX_REQUESTS = 60
