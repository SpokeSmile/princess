"""Environment-based database configuration without exposing connection URLs."""
from urllib.parse import parse_qsl, unquote, urlsplit
from django.core.exceptions import ImproperlyConfigured


def database_config(url, base_dir, *, require_external=False):
    if not url:
        if require_external:
            raise ImproperlyConfigured('Set DATABASE_URL to your PostgreSQL connection URL before deploying to Vercel.')
        return {'ENGINE': 'django.db.backends.sqlite3', 'NAME': base_dir / 'db.sqlite3', 'OPTIONS': {'timeout': 20}}
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
            raise ValueError
        options = {'sslmode': 'require', 'connect_timeout': 10}
        options.update((key, value) for key, value in parse_qsl(parsed.query) if key in ('sslmode', 'channel_binding', 'sslrootcert', 'connect_timeout'))
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': unquote(parsed.path.lstrip('/')),
            'USER': unquote(parsed.username or ''),
            'PASSWORD': unquote(parsed.password or ''),
            'HOST': parsed.hostname,
            'PORT': parsed.port or 5432,
            'CONN_MAX_AGE': 0,
            'DISABLE_SERVER_SIDE_CURSORS': True,
            'OPTIONS': options,
        }
    except (TypeError, ValueError):
        raise ImproperlyConfigured('DATABASE_URL must be a valid PostgreSQL connection URL.') from None
