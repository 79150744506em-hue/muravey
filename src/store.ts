import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {Tag, Task} from './types';

export interface Backend {
    kind: 'cloud' | 'local' | 'server' | 'supabase';
    subscribe(onTasks: (t: Task[]) => void, onTags: (t: Tag[]) => void, onError: (msg: string) => void): () => void;
    saveTask(t: Task): Promise<void>;
    removeTask(id: string): Promise<void>;
    saveTag(t: Tag): Promise<void>;
    removeTag(id: string): Promise<void>;
    /** Слить задачи и теги из резервной копии: совпадающие id перезаписываются, остальное не трогается. */
    importAll(tasks: Task[], tags: Tag[]): Promise<void>;
}

/* ---------- облачное хранилище артефакта (claude db) ---------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDb = any;

function cloudBackend(db: AnyDb, userId: string): Backend {
    const root = db.doc(`data/users/${userId}/muravey`);
    const tasksCol = root.collection('tasks');
    const tagsCol = root.collection('tags');

    // одна запись за раз на документ
    const chains = new Map<string, Promise<void>>();
    const queue = (key: string, fn: () => Promise<void>) => {
        const prev = chains.get(key) ?? Promise.resolve();
        const next = prev.catch(() => {}).then(fn);
        chains.set(key, next);
        next.finally(() => {
            if (chains.get(key) === next) chains.delete(key);
        });
        return withRetry(next, fn);
    };

    return {
        kind: 'cloud',
        subscribe(onTasks, onTags, onError) {
            const err = (e: {code?: string}) => onError(errorText(e?.code));
            const u1 = tasksCol.onSnapshot((s: any) => onTasks(s.docs.map((d: any) => d.data() as Task)), err);
            const u2 = tagsCol.onSnapshot((s: any) => onTags(s.docs.map((d: any) => d.data() as Tag)), err);
            return () => {
                u1();
                u2();
            };
        },
        saveTask: (t) => queue('t:' + t.id, () => tasksCol.doc(t.id).set({...t})),
        removeTask: (id) => queue('t:' + id, () => tasksCol.doc(id).delete()),
        saveTag: (t) => queue('g:' + t.id, () => tagsCol.doc(t.id).set({...t})),
        removeTag: (id) => queue('g:' + id, () => tagsCol.doc(id).delete()),
        async importAll(tasks, tags) {
            for (const t of tags) await queue('g:' + t.id, () => tagsCol.doc(t.id).set({...t}));
            for (const t of tasks) await queue('t:' + t.id, () => tasksCol.doc(t.id).set({...t}));
        },
    };
}

async function withRetry(p: Promise<void>, fn: () => Promise<void>) {
    try {
        await p;
    } catch (e: any) {
        if (e?.code === 'unavailable') {
            await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
            try {
                await fn();
                return;
            } catch (e2: any) {
                throw new Error(errorText(e2?.code));
            }
        }
        throw new Error(errorText(e?.code));
    }
}

function errorText(code?: string) {
    switch (code) {
        case 'quota_exceeded':
            return 'Хранилище заполнено. Удалите старые задачи, чтобы добавить новые.';
        case 'invalid_argument':
            return 'Не получилось сохранить: у этого просмотра нет прав на запись.';
        case 'revoked':
        case 'not_granted':
            return 'Доступ к хранилищу закрыт. Обновите страницу.';
        case 'resource_exhausted':
            return 'Слишком много изменений подряд. Подождите пару секунд.';
        default:
            return 'Не получилось связаться с хранилищем. Изменения могут не сохраниться.';
    }
}

/* ---------- запасной вариант: память браузера ---------- */

const LS_KEY = 'muravey:v1';

function localBackend(): Backend {
    let state: {tasks: Task[]; tags: Tag[]} = {tasks: [], tags: []};
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) state = JSON.parse(raw);
    } catch {
        /* хранилище недоступно */
    }
    const subs = new Set<{onTasks: (t: Task[]) => void; onTags: (t: Tag[]) => void}>();
    const commit = async () => {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(state));
        } catch {
            /* приватное окно и т.п. */
        }
        subs.forEach((s) => {
            s.onTasks(state.tasks);
            s.onTags(state.tags);
        });
    };
    const upsert = <T extends {id: string}>(arr: T[], item: T) => {
        const i = arr.findIndex((x) => x.id === item.id);
        return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
    };
    return {
        kind: 'local',
        subscribe(onTasks, onTags) {
            const s = {onTasks, onTags};
            subs.add(s);
            onTasks(state.tasks);
            onTags(state.tags);
            return () => subs.delete(s);
        },
        async saveTask(t) {
            state = {...state, tasks: upsert(state.tasks, t)};
            await commit();
        },
        async removeTask(id) {
            state = {...state, tasks: state.tasks.filter((x) => x.id !== id)};
            await commit();
        },
        async saveTag(t) {
            state = {...state, tags: upsert(state.tags, t)};
            await commit();
        },
        async removeTag(id) {
            state = {...state, tags: state.tags.filter((x) => x.id !== id)};
            await commit();
        },
        async importAll(tasks, tags) {
            state = {tasks: tasks.reduce(upsert, state.tasks), tags: tags.reduce(upsert, state.tags)};
            await commit();
        },
    };
}

/* ---------- свой сервер в Yandex Cloud ---------- */

const TOKEN_KEY = 'muravey:token';
const CACHE_KEY = 'muravey:server-cache';
const POLL_MS = 30_000;

async function api(body: Record<string, unknown>, token?: string) {
    const res = await fetch('/api', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || String(res.status)), {status: res.status});
    return data;
}

function serverBackend(token: string): Backend {
    type State = {tasks: Task[]; tags: Tag[]};
    let state: State = {tasks: [], tags: []};
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) state = JSON.parse(raw);
    } catch {
        /* без кэша */
    }
    const subs = new Set<{onTasks: (t: Task[]) => void; onTags: (t: Tag[]) => void; onError: (m: string) => void}>();
    const emit = () => {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(state));
        } catch {
            /* без кэша */
        }
        subs.forEach((s) => {
            s.onTasks(state.tasks);
            s.onTags(state.tags);
        });
    };
    const fail = (e: {status?: number}) => {
        if (e?.status === 401) {
            try {
                localStorage.removeItem(TOKEN_KEY);
            } catch {
                /* ничего */
            }
            window.location.reload();
            return 'Нужно войти заново.';
        }
        return 'Не получилось связаться с сервером. Проверьте интернет, изменения могут не сохраниться.';
    };

    // операции отправляются по очереди; пока очередь не пуста, опрос сервера не перетирает локальные правки
    let pending = 0;
    let chain = Promise.resolve();
    const send = (body: Record<string, unknown>, apply: (s: State) => State) => {
        state = apply(state);
        emit();
        pending++;
        const p = chain.then(async () => {
            try {
                const next = (await api(body, token)) as State;
                if (pending === 1) {
                    state = next;
                    emit();
                }
            } finally {
                pending--;
            }
        });
        chain = p.catch(() => {});
        return p.catch((e) => {
            // правка не записалась — сразу берём правду с сервера, чтобы откатить оптимистичное состояние
            void refresh();
            throw new Error(fail(e));
        });
    };
    const refresh = async () => {
        if (pending) return;
        try {
            const next = (await api({action: 'state'}, token)) as State;
            if (!pending) {
                state = next;
                emit();
            }
        } catch (e) {
            const msg = fail(e as {status?: number});
            subs.forEach((s) => s.onError(msg));
        }
    };
    const upsert = <T extends {id: string}>(arr: T[], item: T) => {
        const i = arr.findIndex((x) => x.id === item.id);
        return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
    };

    return {
        kind: 'server',
        subscribe(onTasks, onTags, onError) {
            const s = {onTasks, onTags, onError};
            subs.add(s);
            onTasks(state.tasks);
            onTags(state.tags);
            refresh();
            const id = window.setInterval(refresh, POLL_MS);
            const onVis = () => document.visibilityState === 'visible' && refresh();
            document.addEventListener('visibilitychange', onVis);
            window.addEventListener('focus', refresh);
            return () => {
                subs.delete(s);
                window.clearInterval(id);
                document.removeEventListener('visibilitychange', onVis);
                window.removeEventListener('focus', refresh);
            };
        },
        saveTask: (t) => send({action: 'saveTask', item: t}, (s) => ({...s, tasks: upsert(s.tasks, t)})),
        removeTask: (id) =>
            send({action: 'removeTask', id}, (s) => ({...s, tasks: s.tasks.filter((x) => x.id !== id)})),
        saveTag: (t) => send({action: 'saveTag', item: t}, (s) => ({...s, tags: upsert(s.tags, t)})),
        removeTag: (id) => send({action: 'removeTag', id}, (s) => ({...s, tags: s.tags.filter((x) => x.id !== id)})),
        importAll: (tasks, tags) =>
            send({action: 'import', tasks, tags}, (s) => ({tasks: tasks.reduce(upsert, s.tasks), tags: tags.reduce(upsert, s.tags)})),
    };
}

/* ---------- Supabase (сайт на Netlify) ---------- */

// Значения подставляются при сборке из переменных окружения Netlify. Без них приложение работает как раньше.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const SUPABASE_EMAIL = import.meta.env.VITE_MURAVEY_EMAIL as string | undefined;
const TABLE = 'muravey_items';

type Row = {kind: 'task' | 'tag'; id: string; data: Task | Tag};

function supabaseBackend(sb: SupabaseClient): Backend {
    type State = {tasks: Task[]; tags: Tag[]};
    let state: State = {tasks: [], tags: []};
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) state = JSON.parse(raw);
    } catch {
        /* без кэша */
    }
    const subs = new Set<{onTasks: (t: Task[]) => void; onTags: (t: Tag[]) => void; onError: (m: string) => void}>();
    const emit = () => {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(state));
        } catch {
            /* без кэша */
        }
        subs.forEach((s) => {
            s.onTasks(state.tasks);
            s.onTags(state.tags);
        });
    };
    const failText = 'Не получилось связаться с базой. Проверьте интернет, изменения могут не сохраниться.';
    const check = ({error}: {error: unknown}) => {
        if (error) throw error;
    };

    // пока есть незаписанные правки, свежие данные из базы не перетирают оптимистичное состояние
    let pending = 0;
    let chain = Promise.resolve();
    const send = (write: () => PromiseLike<{error: unknown}>, apply: (s: State) => State) => {
        state = apply(state);
        emit();
        pending++;
        const p = chain.then(async () => {
            try {
                check(await write());
            } finally {
                pending--;
            }
        });
        chain = p.catch(() => {});
        return p.then(
            () => {
                if (!pending) void refresh();
            },
            () => {
                // правка не записалась — берём правду из базы, чтобы откатить оптимистичное состояние
                void refresh();
                throw new Error(failText);
            },
        );
    };
    const refresh = async () => {
        if (pending) return;
        const {data, error} = await sb.from(TABLE).select('kind,id,data');
        if (error) {
            subs.forEach((s) => s.onError(failText));
            return;
        }
        if (pending) return;
        const rows = data as Row[];
        state = {
            tasks: rows.filter((r) => r.kind === 'task').map((r) => r.data as Task),
            tags: rows.filter((r) => r.kind === 'tag').map((r) => r.data as Tag),
        };
        emit();
    };
    const upsert = <T extends {id: string}>(arr: T[], item: T) => {
        const i = arr.findIndex((x) => x.id === item.id);
        return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
    };
    const put = (rows: Row[]) => sb.from(TABLE).upsert(rows, {onConflict: 'user_id,kind,id'});
    const del = (kind: Row['kind'], id: string) => sb.from(TABLE).delete().eq('kind', kind).eq('id', id);

    return {
        kind: 'supabase',
        subscribe(onTasks, onTags, onError) {
            const s = {onTasks, onTags, onError};
            subs.add(s);
            onTasks(state.tasks);
            onTags(state.tags);
            void refresh();
            // изменения с других устройств приходят через Realtime; данных мало, поэтому просто перечитываем всё
            let timer = 0;
            const soon = () => {
                window.clearTimeout(timer);
                timer = window.setTimeout(refresh, 300);
            };
            const channel = sb
                .channel('muravey')
                .on('postgres_changes', {event: '*', schema: 'public', table: TABLE}, soon)
                .subscribe();
            const onVis = () => document.visibilityState === 'visible' && refresh();
            document.addEventListener('visibilitychange', onVis);
            return () => {
                subs.delete(s);
                window.clearTimeout(timer);
                void sb.removeChannel(channel);
                document.removeEventListener('visibilitychange', onVis);
            };
        },
        saveTask: (t) => send(() => put([{kind: 'task', id: t.id, data: t}]), (s) => ({...s, tasks: upsert(s.tasks, t)})),
        removeTask: (id) => send(() => del('task', id), (s) => ({...s, tasks: s.tasks.filter((x) => x.id !== id)})),
        saveTag: (t) => send(() => put([{kind: 'tag', id: t.id, data: t}]), (s) => ({...s, tags: upsert(s.tags, t)})),
        removeTag: (id) => send(() => del('tag', id), (s) => ({...s, tags: s.tags.filter((x) => x.id !== id)})),
        importAll: (tasks, tags) =>
            send(
                () =>
                    put([
                        ...tags.map((t): Row => ({kind: 'tag', id: t.id, data: t})),
                        ...tasks.map((t): Row => ({kind: 'task', id: t.id, data: t})),
                    ]),
                (s) => ({tasks: tasks.reduce(upsert, s.tasks), tags: tags.reduce(upsert, s.tags)}),
            ),
    };
}

async function pickSupabase(): Promise<Startup> {
    const sb = createClient(SUPABASE_URL!, SUPABASE_KEY!);
    const {data} = await sb.auth.getSession();
    if (data.session) return {backend: supabaseBackend(sb)};
    return {
        login: async (password: string) => {
            const {error} = await sb.auth.signInWithPassword({email: SUPABASE_EMAIL ?? '', password});
            if (error) throw Object.assign(new Error(error.message), {status: error.status === 400 ? 401 : error.status});
            return supabaseBackend(sb);
        },
    };
}

export type Startup = {backend: Backend} | {login: (password: string) => Promise<Backend>};

async function hasServer() {
    if (!/^https?:$/.test(window.location.protocol)) return false;
    try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch('/api', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'ping'}),
            signal: ctrl.signal,
        });
        window.clearTimeout(t);
        return res.ok && (await res.json()).ok === true;
    } catch {
        return false;
    }
}

export async function pickBackend(): Promise<Startup> {
    let claude = (window as any).claude;
    for (let i = 0; !claude && i < 5; i++) {
        await new Promise((r) => setTimeout(r, 100));
        claude = (window as any).claude;
    }
    if (claude && typeof claude.use === 'function') {
        try {
            const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
            const id = db && user ? await user.id() : null;
            if (db && id) return {backend: cloudBackend(db, id)};
        } catch {
            /* падаем на локальное хранилище */
        }
        return {backend: localBackend()};
    }
    if (SUPABASE_URL && SUPABASE_KEY) return pickSupabase();
    if (await hasServer()) {
        let token: string | null = null;
        try {
            token = localStorage.getItem(TOKEN_KEY);
        } catch {
            /* нет хранилища */
        }
        if (token) return {backend: serverBackend(token)};
        return {
            login: async (password: string) => {
                const {token: t} = await api({action: 'login', password});
                try {
                    localStorage.setItem(TOKEN_KEY, t);
                } catch {
                    /* войдём заново в следующий раз */
                }
                return serverBackend(t);
            },
        };
    }
    return {backend: localBackend()};
}
