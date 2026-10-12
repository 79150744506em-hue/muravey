# Муравей

Личный таск-менеджер: бэклог, план на сегодня, фокусные задачи, теги и комментарии. React + Gravity UI, собирается в один `index.html`.

- `src/` — интерфейс.
- `api/` — функция Yandex Cloud Functions: вход по паролю и хранение задач в Object Storage.
- `deploy/` — спецификация API-шлюза и скрипт деплоя.
- `.github/workflows/deploy.yml` — каждый push в `main` собирает и выкладывает приложение.

Первичная настройка Yandex Cloud и секретов GitHub описана в [docs/yandex-cloud-setup.md](docs/yandex-cloud-setup.md).

Локально: `npm ci && npm run build`, затем открыть `dist/index.html` (задачи хранятся в браузере).
