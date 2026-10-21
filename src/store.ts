import type {Roadmap, Tag, Task} from './types';

export interface Backend {
    kind: 'cloud' | 'local' | 'server';
    subscribe(
        onTasks: (t: Task[]) => void,
        onTags: (t: Tag[]) => void,
        onError: (msg: string) => void,
        onRoadmaps: (r: Roadmap[]) => void,
    ): () => void;
    saveTask(t: Task): Promise<void>;
    removeTask(id: string): Promise<void>;
    saveTag(t: Tag): Promise<void>;
    removeTag(id: string): Promise<void>;
    saveRoadmap(r: Roadmap): Promise<void>;
    removeRoadmap(id: string): Promise<void>;
    /** включить и выключить публичную ссылку (есть только у своего сервера) */
    shareRoadmap?(id: string): Promise<void>;
    unshareRoadmap?(id: string): Promise<void>;
    /** Слить задачи, теги и дорожные карты из резервной копии: совпадающие id перезаписываются, остальное не трогается. */
    importAll(tasks: Task[], tags: Tag[], roadmaps: Roadmap[]): Promise<void>;
    /** выйти из аккаунта (есть только там, где есть вход) */
    signOut?(): Promise<void>;
}

/* ---------- облачное хранилище артефакта (claude db) ---------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDb = any;

function cloudBackend(db: AnyDb, userId: string): Backend {
    const root = db.doc(`data/users/${userId}/muravey`);
    const tasksCol = root.collection('tasks');
    const tagsCol = root.collection('tags');
    const mapsCol = root.collection('roadmaps');

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
        subscribe(onTasks, onTags, onError, onRoadmaps) {
            const err = (e: {code?: string}) => onError(errorText(e?.code));
            const u1 = tasksCol.onSnapshot((s: any) => onTasks(s.docs.map((d: any) => d.data() as Task)), err);
            const u2 = tagsCol.onSnapshot((s: any) => onTags(s.docs.map((d: any) => d.data() as Tag)), err);
            const u3 = mapsCol.onSnapshot((s: any) => onRoadmaps(s.docs.map((d: any) => d.data() as Roadmap)), err);
            return () => {
                u1();
                u2();
                u3();
            };
        },
        saveTask: (t) => queue('t:' + t.id, () => tasksCol.doc(t.id).set({...t})),
        removeTask: (id) => queue('t:' + id, () => tasksCol.doc(id).delete()),
        saveTag: (t) => queue('g:' + t.id, () => tagsCol.doc(t.id).set({...t})),
        removeTag: (id) => queue('g:' + id, () => tagsCol.doc(id).delete()),
        saveRoadmap: (r) => queue('r:' + r.id, () => mapsCol.doc(r.id).set({...r})),
        removeRoadmap: (id) => queue('r:' + id, () => mapsCol.doc(id).delete()),
        async importAll(tasks, tags, roadmaps) {
            for (const t of tags) await queue('g:' + t.id, () => tagsCol.doc(t.id).set({...t}));
            for (const t of tasks) await queue('t:' + t.id, () => tasksCol.doc(t.id).set({...t}));
            for (const r of roadmaps) await queue('r:' + r.id, () => mapsCol.doc(r.id).set({...r}));
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
    let state: {tasks: Task[]; tags: Tag[]; roadmaps: Roadmap[]} = {tasks: [], tags: [], roadmaps: []};
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) state = {...state, ...JSON.parse(raw)};
    } catch {
        /* хранилище недоступно */
    }
    const subs = new Set<{onTasks: (t: Task[]) => void; onTags: (t: Tag[]) => void; onRoadmaps: (r: Roadmap[]) => void}>();
    const commit = async () => {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(state));
        } catch {
            /* приватное окно и т.п. */
        }
        subs.forEach((s) => {
            s.onTasks(state.tasks);
            s.onTags(state.tags);
            s.onRoadmaps(state.roadmaps);
        });
    };
    const upsert = <T extends {id: string}>(arr: T[], item: T) => {
        const i = arr.findIndex((x) => x.id === item.id);
        return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
    };
    return {
        kind: 'local',
        subscribe(onTasks, onTags, _onError, onRoadmaps) {
            const s = {onTasks, onTags, onRoadmaps};
            subs.add(s);
            onTasks(state.tasks);
            onTags(state.tags);
            onRoadmaps(state.roadmaps);
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
        async saveRoadmap(r) {
            state = {...state, roadmaps: upsert(state.roadmaps, r)};
            await commit();
        },
        async removeRoadmap(id) {
            state = {...state, roadmaps: state.roadmaps.filter((x) => x.id !== id)};
            await commit();
        },
        async importAll(tasks, tags, roadmaps) {
            state = {
                tasks: tasks.reduce(upsert, state.tasks),
                tags: tags.reduce(upsert, state.tags),
                roadmaps: roadmaps.reduce(upsert, state.roadmaps),
            };
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
    if (!res.ok) throw Object.assign(new Error(data.error || String(res.status)), {status: res.status, code: data.error});
    return data;
}

const saveToken = (t: string) => {
    try {
        localStorage.setItem(TOKEN_KEY, t);
    } catch {
        /* войдём заново в следующий раз */
    }
};

const forget = () => {
    try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(CACHE_KEY);
    } catch {
        /* ничего */
    }
};

function serverBackend(initialToken: string): Backend {
    let token = initialToken;
    type State = {tasks: Task[]; tags: Tag[]; roadmaps: Roadmap[]};
    // сервер до дорожных карт присылал только задачи и теги
    const full = (s: Partial<State>): State => ({tasks: [], tags: [], roadmaps: [], ...s});
    let state: State = full({});
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) state = full(JSON.parse(raw));
    } catch {
        /* без кэша */
    }
    const subs = new Set<{
        onTasks: (t: Task[]) => void;
        onTags: (t: Tag[]) => void;
        onError: (m: string) => void;
        onRoadmaps: (r: Roadmap[]) => void;
    }>();
    const emit = () => {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(state));
        } catch {
            /* без кэша */
        }
        subs.forEach((s) => {
            s.onTasks(state.tasks);
            s.onTags(state.tags);
            s.onRoadmaps(state.roadmaps);
        });
    };
    const fail = (e: {status?: number}) => {
        if (e?.status === 401) {
            forget();
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
                const next = full(await api(body, token));
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
            const {token: fresh, ...next} = (await api({action: 'state'}, token)) as State & {token?: string};
            // сервер продлевает ключ входа при каждом открытии
            if (fresh) {
                token = fresh;
                saveToken(fresh);
            }
            if (!pending) {
                state = full(next);
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
        subscribe(onTasks, onTags, onError, onRoadmaps) {
            const s = {onTasks, onTags, onError, onRoadmaps};
            subs.add(s);
            onTasks(state.tasks);
            onTags(state.tags);
            onRoadmaps(state.roadmaps);
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
        saveRoadmap: (r) => send({action: 'saveRoadmap', item: r}, (s) => ({...s, roadmaps: upsert(s.roadmaps, r)})),
        removeRoadmap: (id) =>
            send({action: 'removeRoadmap', id}, (s) => ({...s, roadmaps: s.roadmaps.filter((x) => x.id !== id)})),
        // ключ ссылки придумывает сервер, поэтому здесь ничего не меняем заранее
        shareRoadmap: (id) => send({action: 'shareRoadmap', id}, (s) => s),
        unshareRoadmap: (id) =>
            send({action: 'unshareRoadmap', id}, (s) => ({
                ...s,
                roadmaps: s.roadmaps.map((r) => (r.id === id ? {...r, shareId: null} : r)),
            })),
        importAll: (tasks, tags, roadmaps) =>
            send({action: 'import', tasks, tags, roadmaps}, (s) => ({
                tasks: tasks.reduce(upsert, s.tasks),
                tags: tags.reduce(upsert, s.tags),
                roadmaps: roadmaps.reduce(upsert, s.roadmaps),
            })),
        async signOut() {
            forget();
            window.location.reload();
        },
    };
}

const NONCE_KEY = 'muravey:google-nonce';

/** Вошли под новым аккаунтом: кэш задач прежнего пользователя не показываем */
function signedIn(token: string) {
    forget();
    saveToken(token);
    return serverBackend(token);
}

async function pickServer(google?: string): Promise<Startup> {
    // вернулись со страницы Google: в адресе после # лежит id_token или ошибка
    const hash = new URLSearchParams(window.location.hash.slice(1));
    let loginError: string | undefined;
    if (hash.has('id_token') || hash.has('error')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        let nonce: string | null = null;
        try {
            nonce = sessionStorage.getItem(NONCE_KEY);
            sessionStorage.removeItem(NONCE_KEY);
        } catch {
            /* без nonce сервер откажет */
        }
        if (hash.has('id_token')) {
            try {
                const {token} = await api({action: 'google', idToken: hash.get('id_token'), nonce});
                return {backend: signedIn(token)};
            } catch {
                loginError = 'google';
            }
        } else {
            loginError = hash.get('error') ?? 'google';
        }
    }

    let token: string | null = null;
    try {
        token = localStorage.getItem(TOKEN_KEY);
    } catch {
        /* нет хранилища */
    }
    // ключ старого формата (до аккаунтов) сервер не примет — вход покажется после первого запроса
    if (token) return {backend: serverBackend(token)};
    return {
        withEmail: true,
        login: async (password: string, email: string) => signedIn((await api({action: 'login', email, password})).token),
        signUp: async (email: string, password: string) => signedIn((await api({action: 'signup', email, password})).token),
        google: google
            ? async () => {
                  const nonce = crypto.randomUUID();
                  try {
                      sessionStorage.setItem(NONCE_KEY, nonce);
                  } catch {
                      /* без nonce сервер откажет */
                  }
                  const q = new URLSearchParams({
                      client_id: google,
                      redirect_uri: window.location.origin + '/',
                      response_type: 'id_token',
                      scope: 'openid email',
                      nonce,
                      prompt: 'select_account',
                  });
                  window.location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
              }
            : undefined,
        loginError,
    };
}

export type LoginOptions = {
    /** спрашивать почту или только пароль */
    withEmail: boolean;
    defaultEmail?: string;
    login: (password: string, email: string) => Promise<Backend>;
    /** регистрация; null — аккаунт создан, но нужно подтвердить почту по письму */
    signUp?: (email: string, password: string) => Promise<Backend | null>;
    google?: () => Promise<void>;
    loginError?: string;
};

export type Startup = {backend: Backend} | LoginOptions;

/** Свой сервер отвечает на ping; заодно сообщает, включён ли вход через Google */
async function findServer(): Promise<{google?: string} | null> {
    if (!/^https?:$/.test(window.location.protocol)) return null;
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
        const data = res.ok ? await res.json() : null;
        return data?.ok === true ? {google: data.google} : null;
    } catch {
        return null;
    }
}

/** Дорожная карта по публичной ссылке: всё, кроме привязанных задач. null — ссылку выключили или её нет. */
export async function loadSharedRoadmap(id: string): Promise<Pick<Roadmap, 'title' | 'description' | 'scale' | 'from' | 'to' | 'milestones'> | null> {
    try {
        return (await api({action: 'sharedRoadmap', id})).roadmap;
    } catch (e) {
        if ((e as {status?: number}).status === 404) return null;
        throw e;
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
    const server = await findServer();
    if (server) return pickServer(server.google);
    return {backend: localBackend()};
}
