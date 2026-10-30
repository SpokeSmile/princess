# Размещение на Vercel

Фронтенд и Django работают на одном домене. История, улики, сессии и квота запросов сохраняются в PostgreSQL; ключ Groq остаётся только на сервере.

## 1. База данных

Создайте проект на бесплатном тарифе [Neon](https://neon.com/pricing). В Connect выберите PostgreSQL URL с включённым connection pooling. Он будет выглядеть так:

```text
postgresql://USER:PASSWORD@HOST-pooler.REGION.neon.tech/DB?sslmode=require
```

Вся эта строка становится значением `DATABASE_URL`. Это секрет, его нельзя записывать в Git или клиентский JavaScript.

## 2. Проект Vercel

Импортируйте репозиторий в Vercel или выполните `vercel` из корня проекта. Настройки:

- Root Directory: корень репозитория (`.`), где лежат `vercel.json` и корневой `manage.py`.
- Framework: Django.
- Build Command уже задан в `vercel.json`: `python manage.py migrate --noinput`.
- Output Directory: оставьте по умолчанию для Django. Не указывайте `dist`.

Перед первым Deploy добавьте переменные окружения в Settings → Environment Variables:

| Переменная | Значение |
| --- | --- |
| `GROQ_API_KEY` | Ваш ключ Groq |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` (это также значение по умолчанию) |
| `DATABASE_URL` | Полная строка подключения Neon из первого шага |
| `DJANGO_SECRET_KEY` | Собственная случайная длинная строка, постоянная между деплоями |
| `DJANGO_DEBUG` | `false` |

Секрет Django можно создать у себя командой:

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(50))'
```

Значения из локального `backend/.env` в Vercel автоматически не переносятся. Добавляйте их в настройках проекта, не в `vercel.json`.

## 3. Deploy и домен

Запустите Deploy. Сборка применит миграции к PostgreSQL; Vercel автоматически соберёт статику Django и раздаст её через CDN. Правила для существующих путей `/src/` и `/public/` уже записаны в `vercel.json`.

Стандартные адреса текущего деплоя и production-проекта добавляются в разрешённые хосты автоматически из `VERCEL_URL` и `VERCEL_PROJECT_PRODUCTION_URL`.

Для своего домена добавьте его в Vercel → Settings → Domains, а также задайте:

```dotenv
DJANGO_ALLOWED_HOSTS=example.com,www.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://example.com,https://www.example.com
```

После изменения переменных выполните Redeploy. Постоянный `DJANGO_SECRET_KEY` и одна база сохраняют прогресс между деплоями.

На Vercel приложение намеренно не запускается без `DATABASE_URL`, чтобы прогресс не попадал во временный файл SQLite. Ограничение функции — 40 секунд, ожидание Groq — 25 секунд. Повторных платных обращений и смены модели при ошибках нет.

Локальный запуск по-прежнему использует SQLite, если `DATABASE_URL` пуст. Существующая локальная база не переносится в Neon автоматически: опубликованное расследование начнётся с нового прогресса.
