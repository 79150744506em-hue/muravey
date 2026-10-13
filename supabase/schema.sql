-- Таблица Муравья в Supabase. Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.
create table if not exists public.muravey_items (
    user_id uuid not null default auth.uid() references auth.users on delete cascade,
    kind text not null check (kind in ('task', 'tag')),
    id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, kind, id)
);

-- Доступ через Data API только для вошедшего пользователя.
grant select, insert, update, delete on public.muravey_items to authenticated;

-- Каждый видит и меняет только свои задачи и теги.
alter table public.muravey_items enable row level security;
drop policy if exists "own items" on public.muravey_items;
create policy "own items" on public.muravey_items
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Изменения с других устройств приходят сразу.
alter publication supabase_realtime add table public.muravey_items;
