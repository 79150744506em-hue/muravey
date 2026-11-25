import * as Y from 'yjs';
import type {Backend, BackupSnapshot} from './store';
import type {
    AppNotification,
    CollaborationState,
    EntityDocument,
    EntityKind,
    Product,
    Roadmap,
    SharedAccess,
    StakeholderMap,
    Tag,
    Task,
} from './types';
import {emptyCollaboration} from './types';
import {applyEntity, base64ToBytes, bytesToBase64, createEntityDoc, docToEntity, documentKey} from './collaboration';

type State = {tasks: Task[]; tags: Tag[]; roadmaps: Roadmap[]; stakeholders: StakeholderMap[]; products: Product[]};
type WireDocument = EntityDocument & {state: string};
type Payload = Partial<State> & {
    token?: string;
    documents?: WireDocument[];
    notifications?: AppNotification[];
    indexRevision?: number;
    user?: {id: string; email: string};
    pushAvailable?: boolean;
    pushPublicKey?: string | null;
};
type RuntimeDocument = {
    doc: Y.Doc;
    meta: EntityDocument;
    synced: boolean;
    dirty: boolean;
    change: number;
    chain: Promise<void>;
};
type Api = (body: Record<string, unknown>, token?: string) => Promise<any>;
type Subscriber = {
    onTasks: (t: Task[]) => void;
    onTags: (t: Tag[]) => void;
    onError: (m: string) => void;
    onRoadmaps: (r: Roadmap[]) => void;
    onStakeholders: (m: StakeholderMap[]) => void;
    onProducts: (p: Product[]) => void;
    onConnection: (lost: boolean) => void;
    onCollaboration?: (c: CollaborationState) => void;
};

const full = (s: Partial<State>): State => ({tasks: [], tags: [], roadmaps: [], stakeholders: [], products: [], ...s});
const upsert = <T extends {id: string}>(arr: T[], item: T) => {
    const index = arr.findIndex((x) => x.id === item.id);
    return index === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
};
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function tokenIdentity(token: string) {
    try {
        const encoded = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(decodeURIComponent(escape(atob(encoded))));
        return typeof claims.u === 'string' ? {id: claims.u as string, email: typeof claims.e === 'string' ? claims.e : ''} : null;
    } catch {
        return null;
    }
}

export function createCollaborativeServerBackend(
    initialToken: string,
    deps: {api: Api; saveToken: (token: string) => void; forget: () => void; cacheKey: string},
): Backend {
    let token = initialToken;
    let state: State = full({});
    try {
        const raw = localStorage.getItem(deps.cacheKey);
        if (raw) state = full(JSON.parse(raw));
    } catch {
        /* без кэша */
    }
    const documents = new Map<string, RuntimeDocument>();
    let collaboration: CollaborationState = {...emptyCollaboration, user: tokenIdentity(token)};
    let indexRevision = -1;
    const subs = new Set<Subscriber>();
    let alive = true;
    let polling = false;
    let entityPending = 0;

    const collection = (kind: EntityKind): 'roadmaps' | 'stakeholders' | 'products' =>
        kind === 'roadmap' ? 'roadmaps' : kind === 'product' ? 'products' : 'stakeholders';

    const merged = <T extends {id: string}>(kind: EntityKind, own: T[]): T[] => {
        const key = collection(kind);
        const result = own.filter((item) => !documents.has(documentKey(kind, collaboration.user?.id ?? '', item.id)));
        for (const runtime of documents.values()) {
            if (runtime.meta.kind === kind) {
                const entity = docToEntity<T>(runtime.doc);
                const index = result.findIndex((item) => item.id === runtime.meta.id && runtime.meta.access === 'owner');
                if (index >= 0) result[index] = entity;
                else result.push(entity);
            }
        }
        return result;
    };

    const emit = () => {
        try {
            localStorage.setItem(deps.cacheKey, JSON.stringify(state));
        } catch {
            /* без кэша */
        }
        const metadata = Object.fromEntries([...documents].map(([key, runtime]) => [key, runtime.meta]));
        collaboration = {...collaboration, documents: metadata};
        subs.forEach((subscriber) => {
            subscriber.onTasks(state.tasks);
            subscriber.onTags(state.tags);
            subscriber.onRoadmaps(merged<Roadmap>('roadmap', state.roadmaps));
            subscriber.onStakeholders(merged<StakeholderMap>('stakeholderMap', state.stakeholders));
            subscriber.onProducts(merged<Product>('product', state.products));
            subscriber.onCollaboration?.(collaboration);
        });
    };

    const reportConnection = (lost: boolean) => subs.forEach((subscriber) => subscriber.onConnection(lost));
    const fail = (error: {status?: number; code?: string; message?: string}) => {
        if (error?.status === 401) {
            deps.forget();
            window.location.reload();
            return Object.assign(new Error('Нужно войти заново.'), {code: 'unauthorized'});
        }
        if (error?.status === 403 || error?.status === 404 || error?.status === 409 || error?.status === 400) {
            return Object.assign(new Error(error.message || error.code || 'Действие недоступно.'), {
                code: error.code,
                status: error.status,
            });
        }
        return Object.assign(new Error('Соединение потеряно. Изменения могут не сохраниться.'), {code: 'connection_lost'});
    };

    const applyDocument = (wire: WireDocument) => {
        const key = wire.key || documentKey(wire.kind, wire.ownerId, wire.id);
        let runtime = documents.get(key);
        if (!runtime) {
            runtime = {
                doc: new Y.Doc(),
                meta: {...wire},
                synced: true,
                dirty: false,
                change: 0,
                chain: Promise.resolve(),
            };
            documents.set(key, runtime);
        }
        if (wire.state) Y.applyUpdate(runtime.doc, base64ToBytes(wire.state), 'remote');
        const {state: _state, ...meta} = wire;
        if (wire.revision >= runtime.meta.revision || !runtime.synced) runtime.meta = {...meta, revision: wire.revision};
        runtime.synced = true;
        return runtime;
    };

    const applyPayload = (payload: Payload, complete = false) => {
        if (payload.user) collaboration = {...collaboration, user: payload.user};
        if (payload.notifications) collaboration = {...collaboration, notifications: payload.notifications};
        if (typeof payload.pushAvailable === 'boolean') collaboration = {...collaboration, pushAvailable: payload.pushAvailable};
        if (payload.pushPublicKey !== undefined) collaboration = {...collaboration, pushPublicKey: payload.pushPublicKey};
        if (typeof payload.indexRevision === 'number') indexRevision = payload.indexRevision;
        const visible = new Set<string>();
        for (const wire of payload.documents ?? []) {
            visible.add(wire.key);
            applyDocument(wire);
        }
        if (complete && payload.documents) {
            for (const [key, runtime] of documents) {
                if (runtime.synced && !runtime.dirty && !visible.has(key)) documents.delete(key);
            }
        }
    };

    const syncBaseFromDocument = (runtime: RuntimeDocument) => {
        if (runtime.meta.access !== 'owner') return;
        const kind = runtime.meta.kind;
        if (kind === 'roadmap') state = {...state, roadmaps: upsert(state.roadmaps, docToEntity<Roadmap>(runtime.doc))};
        else if (kind === 'product') state = {...state, products: upsert(state.products, docToEntity<Product>(runtime.doc))};
        else state = {...state, stakeholders: upsert(state.stakeholders, docToEntity<StakeholderMap>(runtime.doc))};
    };

    let pending = 0;
    let chain = Promise.resolve();
    let refreshing = false;

    const ensureDocuments = () => {
        const ownerId = collaboration.user?.id;
        if (!ownerId) return;
        const groups: [EntityKind, (Roadmap | Product | StakeholderMap)[]][] = [
            ['roadmap', state.roadmaps],
            ['product', state.products],
            ['stakeholderMap', state.stakeholders],
        ];
        for (const [kind, items] of groups) {
            for (const item of items) {
                const key = documentKey(kind, ownerId, item.id);
                if (documents.has(key)) continue;
                const runtime: RuntimeDocument = {
                    doc: createEntityDoc(item as unknown as Record<string, unknown>),
                    meta: {
                        key,
                        kind,
                        id: item.id,
                        ownerId,
                        ownerEmail: collaboration.user?.email ?? '',
                        access: 'owner',
                        revision: 0,
                        members: [],
                    },
                    synced: false,
                    dirty: true,
                    change: 1,
                    chain: Promise.resolve(),
                };
                documents.set(key, runtime);
                void queueDocumentSave(runtime).catch(() => {});
            }
        }
    };

    async function refresh() {
        if (pending || entityPending || refreshing) return;
        refreshing = true;
        try {
            const payload = (await deps.api({action: 'state'}, token)) as Payload;
            if (payload.token) {
                token = payload.token;
                deps.saveToken(token);
            }
            const {token: _token, ...data} = payload;
            applyPayload(data, true);
            state = full(data);
            ensureDocuments();
            emit();
            reportConnection(false);
        } catch (error) {
            const failed = fail(error as {status?: number});
            if (failed.code === 'connection_lost') reportConnection(true);
            else subs.forEach((subscriber) => subscriber.onError(failed.message));
        } finally {
            refreshing = false;
        }
    }

    const send = (body: Record<string, unknown>, apply: (s: State) => State) => {
        state = apply(state);
        emit();
        pending++;
        const promise = chain.then(async () => {
            try {
                const payload = (await deps.api(body, token)) as Payload;
                reportConnection(false);
                if (pending === 1) {
                    const {token: _token, documents: _documents, ...next} = payload;
                    applyPayload(payload, true);
                    state = full(next);
                    ensureDocuments();
                    emit();
                }
            } finally {
                pending--;
            }
        });
        chain = promise.catch(() => {});
        return promise.catch((error) => {
            const failed = fail(error as {status?: number});
            if (failed.code === 'connection_lost') reportConnection(true);
            void refresh();
            throw failed;
        });
    };

    function queueDocumentSave(runtime: RuntimeDocument): Promise<void> {
        entityPending++;
        const promise = runtime.chain.catch(() => {}).then(async () => {
            const change = runtime.change;
            try {
                const response = (await deps.api(
                    {
                        action: 'saveEntity',
                        kind: runtime.meta.kind,
                        id: runtime.meta.id,
                        ownerId: runtime.meta.ownerId,
                        update: bytesToBase64(Y.encodeStateAsUpdate(runtime.doc)),
                        stateVector: bytesToBase64(Y.encodeStateVector(runtime.doc)),
                    },
                    token,
                )) as {document: WireDocument};
                const currentKey = documentKey(runtime.meta.kind, runtime.meta.ownerId, runtime.meta.id);
                if (documents.get(currentKey) !== runtime) return;
                applyDocument(response.document);
                if (runtime.change === change) runtime.dirty = false;
                syncBaseFromDocument(runtime);
                reportConnection(false);
                emit();
            } catch (error) {
                runtime.dirty = true;
                throw error;
            } finally {
                entityPending--;
            }
        });
        runtime.chain = promise;
        return promise.catch((error) => {
            const failed = fail(error as {status?: number; code?: string});
            if (failed.code === 'connection_lost') reportConnection(true);
            throw failed;
        });
    }

    const saveEntity = <T extends {id: string}>(kind: EntityKind, entity: T): Promise<void> => {
        let runtime = [...documents.values()].find((item) => item.meta.kind === kind && item.meta.id === entity.id);
        const ownerId = collaboration.user?.id;
        if (!runtime && !ownerId) return Promise.reject(new Error('Дождитесь входа в аккаунт.'));
        if (!runtime && ownerId) {
            const key = documentKey(kind, ownerId, entity.id);
            runtime = {
                doc: createEntityDoc(entity as unknown as Record<string, unknown>),
                meta: {
                    key,
                    kind,
                    id: entity.id,
                    ownerId,
                    ownerEmail: collaboration.user?.email ?? '',
                    access: 'owner',
                    revision: 0,
                    members: [],
                },
                synced: false,
                dirty: true,
                change: 0,
                chain: Promise.resolve(),
            };
            documents.set(key, runtime);
        }
        if (!runtime) return Promise.reject(new Error('Документ не найден.'));
        if (runtime.meta.access === 'view') {
            return Promise.reject(Object.assign(new Error('У вас доступ только на просмотр.'), {code: 'read_only'}));
        }
        applyEntity(runtime.doc, entity as unknown as Record<string, unknown>);
        runtime.dirty = true;
        runtime.change++;
        syncBaseFromDocument(runtime);
        emit();
        return queueDocumentSave(runtime);
    };

    async function poll() {
        if (polling || !alive) return;
        polling = true;
        while (alive) {
            try {
                const requested = [...documents.values()]
                    .filter((runtime) => runtime.synced && !runtime.dirty)
                    .map((runtime) => ({
                        kind: runtime.meta.kind,
                        id: runtime.meta.id,
                        ownerId: runtime.meta.ownerId,
                        revision: runtime.meta.revision,
                        stateVector: bytesToBase64(Y.encodeStateVector(runtime.doc)),
                    }));
                const response = (await deps.api({action: 'sync', documents: requested, indexRevision}, token)) as Payload & {
                    removed?: string[];
                };
                applyPayload(response);
                for (const key of response.removed ?? []) {
                    const runtime = documents.get(key);
                    if (runtime && !runtime.dirty) documents.delete(key);
                }
                for (const runtime of documents.values()) {
                    if (runtime.dirty && !entityPending) void queueDocumentSave(runtime).catch(() => {});
                }
                emit();
                reportConnection(false);
            } catch (error) {
                const failed = fail(error as {status?: number});
                if (failed.code === 'connection_lost') reportConnection(true);
                await wait(2500);
            }
        }
        polling = false;
    }

    const removeCollaborativeEntity = async (kind: EntityKind, id: string, ownerId: string) => {
        const key = documentKey(kind, ownerId, id);
        const runtime = documents.get(key);
        documents.delete(key);
        const field = collection(kind);
        state = {...state, [field]: state[field].filter((item: {id: string}) => item.id !== id)} as State;
        emit();
        try {
            await deps.api({action: 'removeEntity', kind, id, ownerId}, token);
            reportConnection(false);
        } catch (error) {
            if (runtime) documents.set(key, runtime);
            void refresh();
            throw fail(error as {status?: number});
        }
    };

    const request = async (body: Record<string, unknown>, reload = true) => {
        try {
            const response = await deps.api(body, token);
            if (response.document) applyDocument(response.document as WireDocument);
            reportConnection(false);
            emit();
            if (reload) await refresh();
        } catch (error) {
            const failed = fail(error as {status?: number; code?: string});
            if (failed.code === 'connection_lost') reportConnection(true);
            throw failed;
        }
    };

    return {
        kind: 'server',
        subscribe(onTasks, onTags, onError, onRoadmaps, onStakeholders, onProducts, onConnection, onCollaboration) {
            alive = true;
            const subscriber = {onTasks, onTags, onError, onRoadmaps, onStakeholders, onProducts, onConnection, onCollaboration};
            subs.add(subscriber);
            onTasks(state.tasks);
            onTags(state.tags);
            onRoadmaps(merged<Roadmap>('roadmap', state.roadmaps));
            onStakeholders(merged<StakeholderMap>('stakeholderMap', state.stakeholders));
            onProducts(merged<Product>('product', state.products));
            onCollaboration?.(collaboration);
            void refresh().finally(() => void poll());
            const onVis = () => {
                if (document.visibilityState === 'visible') void refresh();
            };
            document.addEventListener('visibilitychange', onVis);
            window.addEventListener('focus', refresh);
            window.addEventListener('online', refresh);
            return () => {
                alive = false;
                subs.delete(subscriber);
                document.removeEventListener('visibilitychange', onVis);
                window.removeEventListener('focus', refresh);
                window.removeEventListener('online', refresh);
            };
        },
        saveTask: (task) => send({action: 'saveTask', item: task}, (s) => ({...s, tasks: upsert(s.tasks, task)})),
        removeTask: (id) => send({action: 'removeTask', id}, (s) => ({...s, tasks: s.tasks.filter((x) => x.id !== id)})),
        saveTag: (tag) => send({action: 'saveTag', item: tag}, (s) => ({...s, tags: upsert(s.tags, tag)})),
        removeTag: (id) => send({action: 'removeTag', id}, (s) => ({...s, tags: s.tags.filter((x) => x.id !== id)})),
        saveRoadmap: (roadmap) => saveEntity('roadmap', roadmap),
        removeRoadmap: (id) => {
            const runtime = [...documents.values()].find((item) => item.meta.kind === 'roadmap' && item.meta.id === id);
            return runtime
                ? removeCollaborativeEntity('roadmap', id, runtime.meta.ownerId)
                : send({action: 'removeRoadmap', id}, (s) => ({...s, roadmaps: s.roadmaps.filter((x) => x.id !== id)}));
        },
        saveStakeholderMap: (map) => saveEntity('stakeholderMap', map),
        removeStakeholderMap: (id) => {
            const runtime = [...documents.values()].find((item) => item.meta.kind === 'stakeholderMap' && item.meta.id === id);
            return runtime
                ? removeCollaborativeEntity('stakeholderMap', id, runtime.meta.ownerId)
                : send({action: 'removeStakeholderMap', id}, (s) => ({
                      ...s,
                      stakeholders: s.stakeholders.filter((x) => x.id !== id),
                  }));
        },
        saveProduct: (product) => saveEntity('product', product),
        removeProduct: (id) => {
            const runtime = [...documents.values()].find((item) => item.meta.kind === 'product' && item.meta.id === id);
            return runtime
                ? removeCollaborativeEntity('product', id, runtime.meta.ownerId)
                : send({action: 'removeProduct', id}, (s) => ({...s, products: s.products.filter((x) => x.id !== id)}));
        },
        shareRoadmap: (id) => send({action: 'shareRoadmap', id}, (s) => s),
        unshareRoadmap: (id) =>
            send({action: 'unshareRoadmap', id}, (s) => ({
                ...s,
                roadmaps: s.roadmaps.map((r) => (r.id === id ? {...r, shareId: null} : r)),
            })),
        importAll: (tasks, tags, roadmaps, stakeholders, products) =>
            send({action: 'import', tasks, tags, roadmaps, stakeholders, products}, (s) => ({
                tasks: tasks.reduce(upsert, s.tasks),
                tags: tags.reduce(upsert, s.tags),
                roadmaps: roadmaps.reduce(upsert, s.roadmaps),
                stakeholders: stakeholders.reduce(upsert, s.stakeholders),
                products: products.reduce(upsert, s.products),
            })),
        async listBackups() {
            try {
                const result = await deps.api({action: 'listBackups'}, token);
                reportConnection(false);
                return Array.isArray(result.backups) ? (result.backups as BackupSnapshot[]) : [];
            } catch (error) {
                const failed = fail(error as {status?: number});
                if (failed.code === 'connection_lost') reportConnection(true);
                throw failed;
            }
        },
        restoreBackup: (slot) => send({action: 'restoreBackup', slot}, (s) => s),
        async setEntityAccess(kind: EntityKind, id: string, ownerId: string, email: string, access: SharedAccess) {
            await request({action: 'setEntityAccess', kind, id, ownerId, email, access});
        },
        async removeEntityAccess(kind: EntityKind, id: string, ownerId: string, userId: string) {
            await request({action: 'removeEntityAccess', kind, id, ownerId, userId});
        },
        async leaveEntity(kind: EntityKind, id: string, ownerId: string) {
            await request({action: 'leaveEntity', kind, id, ownerId});
        },
        async markNotificationsRead(ids?: string[]) {
            const at = new Date().toISOString();
            collaboration = {
                ...collaboration,
                notifications: collaboration.notifications.map((item) =>
                    !item.readAt && (!ids || ids.includes(item.id)) ? {...item, readAt: at} : item,
                ),
            };
            emit();
            await request({action: 'markNotificationsRead', ...(ids ? {ids} : {})}, false);
        },
        async subscribePush(subscription: PushSubscriptionJSON) {
            await request({action: 'pushSubscribe', subscription}, false);
        },
        async unsubscribePush(endpoint: string) {
            await request({action: 'pushUnsubscribe', endpoint}, false);
        },
        async signOut() {
            deps.forget();
            window.location.reload();
        },
    };
}
