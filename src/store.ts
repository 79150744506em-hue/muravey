import type {CollaborationState, EntityKind, Product, Roadmap, SharedAccess, StakeholderMap, Tag, Task} from './types';
import {createCollaborativeServerBackend} from './serverBackend';

export interface BackupSnapshot {
    slot: number;
    savedAt: string;
    tasks: number;
    tags: number;
    roadmaps: number;
    stakeholders: number;
    products: number;
}

export interface Backend {
    kind: 'cloud' | 'local' | 'server';
    subscribe(
        onTasks: (t: Task[]) => void,
        onTags: (t: Tag[]) => void,
        onError: (msg: string) => void,
        onRoadmaps: (r: Roadmap[]) => void,
        onStakeholders: (m: StakeholderMap[]) => void,
        onProducts: (p: Product[]) => void,
        onConnection: (lost: boolean) => void,
        onCollaboration?: (c: CollaborationState) => void,
    ): () => void;
    saveTask(t: Task): Promise<void>;
    removeTask(id: string): Promise<void>;
    saveTag(t: Tag): Promise<void>;
    removeTag(id: string): Promise<void>;
    saveRoadmap(r: Roadmap): Promise<void>;
    removeRoadmap(id: string): Promise<void>;
    saveStakeholderMap(m: StakeholderMap): Promise<void>;
    removeStakeholderMap(id: string): Promise<void>;
    saveProduct(p: Product): Promise<void>;
    removeProduct(id: string): Promise<void>;
    /** включить и выключить публичную ссылку (есть только у своего сервера) */
    shareRoadmap?(id: string): Promise<void>;
    unshareRoadmap?(id: string): Promise<void>;
    /** Слить задачи, теги, дорожные карты, карты стейкхолдеров и продукты из резервной копии: совпадающие id перезаписываются, остальное не трогается. */
    importAll(tasks: Task[], tags: Tag[], roadmaps: Roadmap[], stakeholders: StakeholderMap[], products: Product[]): Promise<void>;
    /** Автоматические копии на своём сервере и восстановление всего состояния из выбранной. */
    listBackups?(): Promise<BackupSnapshot[]>;
    restoreBackup?(slot: number): Promise<void>;
    setEntityAccess?(kind: EntityKind, id: string, ownerId: string, email: string, access: SharedAccess): Promise<void>;
    removeEntityAccess?(kind: EntityKind, id: string, ownerId: string, userId: string): Promise<void>;
    leaveEntity?(kind: EntityKind, id: string, ownerId: string): Promise<void>;
    markNotificationsRead?(ids?: string[]): Promise<void>;
    subscribePush?(subscription: PushSubscriptionJSON): Promise<void>;
    unsubscribePush?(endpoint: string): Promise<void>;
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
    const peopleCol = root.collection('stakeholders');
    const productsCol = root.collection('products');

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
        subscribe(onTasks, onTags, onError, onRoadmaps, onStakeholders, onProducts, onConnection) {
            const err = (e: {code?: string}) => {
                if (e?.code === 'unavailable') onConnection(true);
                else onError(errorText(e?.code));
            };
            const ready = () => onConnection(false);
            const u1 = tasksCol.onSnapshot((s: any) => {
                ready();
                onTasks(s.docs.map((d: any) => d.data() as Task));
            }, err);
            const u2 = tagsCol.onSnapshot((s: any) => {
                ready();
                onTags(s.docs.map((d: any) => d.data() as Tag));
            }, err);
            const u3 = mapsCol.onSnapshot((s: any) => {
                ready();
                onRoadmaps(s.docs.map((d: any) => d.data() as Roadmap));
            }, err);
            const u4 = peopleCol.onSnapshot(
                (s: any) => {
                    ready();
                    onStakeholders(s.docs.map((d: any) => d.data() as StakeholderMap));
                },
                err,
            );
            const u5 = productsCol.onSnapshot((s: any) => {
                ready();
                onProducts(s.docs.map((d: any) => d.data() as Product));
            }, err);
            return () => {
                u1();
                u2();
                u3();
                u4();
                u5();
            };
        },
        saveTask: (t) => queue('t:' + t.id, () => tasksCol.doc(t.id).set({...t})),
        removeTask: (id) => queue('t:' + id, () => tasksCol.doc(id).delete()),
        saveTag: (t) => queue('g:' + t.id, () => tagsCol.doc(t.id).set({...t})),
        removeTag: (id) => queue('g:' + id, () => tagsCol.doc(id).delete()),
        saveRoadmap: (r) => queue('r:' + r.id, () => mapsCol.doc(r.id).set({...r})),
        removeRoadmap: (id) => queue('r:' + id, () => mapsCol.doc(id).delete()),
        saveStakeholderMap: (m) => queue('s:' + m.id, () => peopleCol.doc(m.id).set({...m})),
        removeStakeholderMap: (id) => queue('s:' + id, () => peopleCol.doc(id).delete()),
        saveProduct: (p) => queue('p:' + p.id, () => productsCol.doc(p.id).set({...p})),
        removeProduct: (id) => queue('p:' + id, () => productsCol.doc(id).delete()),
        async importAll(tasks, tags, roadmaps, stakeholders, products) {
            for (const t of tags) await queue('g:' + t.id, () => tagsCol.doc(t.id).set({...t}));
            for (const t of tasks) await queue('t:' + t.id, () => tasksCol.doc(t.id).set({...t}));
            for (const r of roadmaps) await queue('r:' + r.id, () => mapsCol.doc(r.id).set({...r}));
            for (const m of stakeholders) await queue('s:' + m.id, () => peopleCol.doc(m.id).set({...m}));
            for (const p of products) await queue('p:' + p.id, () => productsCol.doc(p.id).set({...p}));
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
    let state: {tasks: Task[]; tags: Tag[]; roadmaps: Roadmap[]; stakeholders: StakeholderMap[]; products: Product[]} = {
        tasks: [],
        tags: [],
        roadmaps: [],
        stakeholders: [],
        products: [],
    };
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) state = {...state, ...JSON.parse(raw)};
    } catch {
        /* хранилище недоступно */
    }
    const subs = new Set<{
        onTasks: (t: Task[]) => void;
        onTags: (t: Tag[]) => void;
        onError: (m: string) => void;
        onRoadmaps: (r: Roadmap[]) => void;
        onStakeholders: (m: StakeholderMap[]) => void;
        onProducts: (p: Product[]) => void;
        onConnection: (lost: boolean) => void;
    }>();
    const commit = async () => {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(state));
        } catch {
            const message = 'Не получилось сохранить изменения в браузере. Проверьте доступ к хранилищу и свободное место.';
            subs.forEach((s) => s.onError(message));
            throw new Error(message);
        }
        subs.forEach((s) => {
            s.onTasks(state.tasks);
            s.onTags(state.tags);
            s.onRoadmaps(state.roadmaps);
            s.onStakeholders(state.stakeholders);
            s.onProducts(state.products);
        });
    };
    const upsert = <T extends {id: string}>(arr: T[], item: T) => {
        const i = arr.findIndex((x) => x.id === item.id);
        return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
    };
    return {
        kind: 'local',
        subscribe(onTasks, onTags, onError, onRoadmaps, onStakeholders, onProducts, onConnection) {
            const s = {onTasks, onTags, onError, onRoadmaps, onStakeholders, onProducts, onConnection};
            subs.add(s);
            onConnection(false);
            onTasks(state.tasks);
            onTags(state.tags);
            onRoadmaps(state.roadmaps);
            onStakeholders(state.stakeholders);
            onProducts(state.products);
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
        async saveStakeholderMap(m) {
            state = {...state, stakeholders: upsert(state.stakeholders, m)};
            await commit();
        },
        async removeStakeholderMap(id) {
            state = {...state, stakeholders: state.stakeholders.filter((x) => x.id !== id)};
            await commit();
        },
        async saveProduct(p) {
            state = {...state, products: upsert(state.products, p)};
            await commit();
        },
        async removeProduct(id) {
            state = {...state, products: state.products.filter((x) => x.id !== id)};
            await commit();
        },
        async importAll(tasks, tags, roadmaps, stakeholders, products) {
            state = {
                tasks: tasks.reduce(upsert, state.tasks),
                tags: tags.reduce(upsert, state.tags),
                roadmaps: roadmaps.reduce(upsert, state.roadmaps),
                stakeholders: stakeholders.reduce(upsert, state.stakeholders),
                products: products.reduce(upsert, state.products),
            };
            await commit();
        },
    };
}

/* ---------- свой сервер в Yandex Cloud ---------- */

const TOKEN_KEY = 'muravey:token';
const CACHE_KEY = 'muravey:server-cache';

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
    return createCollaborativeServerBackend(initialToken, {api, saveToken, forget, cacheKey: CACHE_KEY});
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
export async function loadSharedRoadmap(
    id: string,
): Promise<Pick<Roadmap, 'title' | 'description' | 'scale' | 'from' | 'to' | 'milestones' | 'epics' | 'deadlines'> | null> {
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
