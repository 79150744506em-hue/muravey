# Муравей на Netlify + Supabase

Сайт раздаёт Netlify, задачи и вход по паролю живут в Supabase. Каждый пуш в `main` сам выкатывается на сайт.

## Supabase
1. Создай проект (регион Frankfurt или другой европейский).
2. SQL Editor → New query → вставь содержимое `supabase/schema.sql` → Run.
3. Authentication → Users → Add user → Create new user: почта и пароль, галка Auto Confirm User. Этим паролем будешь входить.
4. Authentication → Sign In / Providers: «Allow new users to sign up» включено — друзья регистрируются сами (почта и пароль или Google), у каждого своё пространство: правила доступа в базе отдают только его задачи. Выключи, если регистрацию нужно закрыть.
5. Project Settings → API Keys: скопируй Project URL и anon (или publishable) key. Секретный service_role key не нужен.

## Netlify
1. Add new site → Import an existing project → GitHub → `muravey`.
2. Перед деплоем добавь переменные окружения:
   - `VITE_SUPABASE_URL` — Project URL
   - `VITE_SUPABASE_ANON_KEY` — anon/publishable key
   - `VITE_MURAVEY_EMAIL` — почта пользователя из шага 3
3. Deploy. Сайт откроется по адресу вида `https://<имя>.netlify.app`.

## Перенос задач
В локальной версии «…» → «Скачать резервную копию», на сайте «…» → «Загрузить из файла».
