const crypto = require('node:crypto');
const Y = require('yjs');
const webpush = require('web-push');

const KINDS = new Set(['product', 'roadmap', 'stakeholderMap']);
const STATE_KEYS = {product: 'products', roadmap: 'roadmaps', stakeholderMap: 'stakeholders'};
const ARRAY_KEYS = {product: 'tasks', roadmap: 'milestones', stakeholderMap: 'stakeholders'};
const POLL_MS = 850;
const WAIT_MS = 6500;
const MAX_UPDATE_BYTES = 3 * 1024 * 1024;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || (VAPID_PRIVATE_KEY ? publicKeyFromPrivate(VAPID_PRIVATE_KEY) : '');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:muravey@example.com';
const pushAvailable = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

function publicKeyFromPrivate(privateKey) {
    try {
        const ecdh = crypto.createECDH('prime256v1');
        ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
        return ecdh.getPublicKey(null, 'uncompressed').toString('base64url');
    } catch {
        return '';
    }
}
if (pushAvailable) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const documentKey = (kind, ownerId, id) => `${kind}:${ownerId}:${id}`;
const entityKey = (kind, ownerId, id) => `entities/${ownerId}/${kind}/${id}.json`;
const sharingKey = (uid) => `users/${uid}/sharing.json`;
const emptyIndex = () => ({version: 1, revision: 0, memberships: [], notifications: [], subscriptions: []});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkRef(req, fail) {
    const kind = String(req.kind || '');
    const id = String(req.id || '');
    const ownerId = String(req.ownerId || '');
    if (!KINDS.has(kind) || !/^[\w-]{1,128}$/.test(id) || !/^[\w-]{1,128}$/.test(ownerId)) {
        throw fail(400, 'bad_entity');
    }
    return {kind, id, ownerId};
}

function decodeUpdate(value, fail) {
    try {
        const bytes = Buffer.from(String(value || ''), 'base64');
        if (bytes.length > MAX_UPDATE_BYTES) throw fail(413, 'update_too_large');
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } catch (e) {
        if (e.statusCode) throw e;
        throw fail(400, 'bad_update');
    }
}

function encodeJson(value) {
    if (typeof value === 'string') return new Y.Text(value);
    if (Array.isArray(value)) {
        const array = new Y.Array();
        array.push(value.map(encodeJson));
        return array;
    }
    if (value && typeof value === 'object') {
        const map = new Y.Map();
        for (const [key, item] of Object.entries(value)) {
            if (item !== undefined) map.set(key, encodeJson(item));
        }
        return map;
    }
    return value ?? null;
}

function jsonValue(value) {
    if (value instanceof Y.Text) return value.toString();
    if (value instanceof Y.Array) return value.toArray().map(jsonValue);
    if (value instanceof Y.Map) {
        const result = {};
        value.forEach((item, key) => {
            result[key] = jsonValue(item);
        });
        return result;
    }
    return value;
}

function entityData(doc, ref, fail) {
    const data = jsonValue(doc.getMap('entity').get('root'));
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== ref.id || typeof data.title !== 'string') {
        throw fail(400, 'bad_document');
    }
    if (!Array.isArray(data[ARRAY_KEYS[ref.kind]])) throw fail(400, 'bad_document');
    return data;
}

function openDocument(saved, ref, fail) {
    const doc = new Y.Doc();
    if (saved) Y.applyUpdate(doc, decodeUpdate(saved, fail));
    return doc;
}

function setText(map, key, value) {
    if (value === null || value === undefined) {
        map.delete(key);
        return;
    }
    const current = map.get(key);
    if (current instanceof Y.Text) {
        const text = String(value);
        if (current.toString() !== text) {
            current.delete(0, current.length);
            current.insert(0, text);
        }
    } else {
        map.set(key, new Y.Text(String(value)));
    }
}

async function readIndex(uid, iam, deps) {
    const saved = await deps.readJson(iam, sharingKey(uid), true);
    const data = saved.data || emptyIndex();
    return {
        etag: saved.etag,
        exists: saved.data !== null,
        data: {
            ...emptyIndex(),
            ...data,
            memberships: Array.isArray(data.memberships) ? data.memberships : [],
            notifications: Array.isArray(data.notifications) ? data.notifications : [],
            subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
        },
    };
}

async function mutateIndex(uid, iam, deps, mutate) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await readIndex(uid, iam, deps);
        const next = JSON.parse(JSON.stringify(saved.data));
        const result = await mutate(next);
        if (result === false) return null;
        next.revision = (Number(saved.data.revision) || 0) + 1;
        try {
            await deps.writeJson(iam, sharingKey(uid), next, saved.etag, !saved.exists);
            return next;
        } catch (e) {
            if (e?.statusCode !== 409 || attempt === 4) throw e;
        }
    }
    return null;
}

async function addMembership(uid, ref, iam, deps) {
    const key = documentKey(ref.kind, ref.ownerId, ref.id);
    await mutateIndex(uid, iam, deps, (index) => {
        if (index.memberships.some((item) => item.key === key)) return false;
        index.memberships.push({key, ...ref});
    });
}

async function removeMembership(uid, key, iam, deps) {
    await mutateIndex(uid, iam, deps, (index) => {
        const before = index.memberships.length;
        index.memberships = index.memberships.filter((item) => item.key !== key);
        return before === index.memberships.length ? false : undefined;
    });
}

function accessFor(doc, uid) {
    if (doc.ownerId === uid) return 'owner';
    return doc.members?.[uid]?.access || null;
}

function publicDocument(doc, uid, state = doc.state) {
    return {
        key: documentKey(doc.kind, doc.ownerId, doc.id),
        kind: doc.kind,
        id: doc.id,
        ownerId: doc.ownerId,
        ownerEmail: doc.ownerEmail || '',
        access: accessFor(doc, uid),
        revision: doc.revision,
        members: Object.entries(doc.members || {})
            .map(([userId, member]) => ({userId, email: member.email, access: member.access, addedAt: member.addedAt}))
            .sort((a, b) => a.email.localeCompare(b.email)),
        state,
    };
}

async function mirrorEntity(ref, data, iam, deps) {
    const stateKey = STATE_KEYS[ref.kind];
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await deps.readJson(iam, deps.stateKey(ref.ownerId), true);
        const state = {tasks: [], tags: [], roadmaps: [], stakeholders: [], products: [], ...(saved.data || {})};
        const list = Array.isArray(state[stateKey]) ? state[stateKey] : [];
        const next = [...list];
        const index = next.findIndex((item) => item.id === ref.id);
        if (data === null) {
            if (index < 0) return;
            next.splice(index, 1);
        } else if (index < 0) {
            next.push(data);
        } else {
            next[index] = data;
        }
        state[stateKey] = next;
        try {
            await deps.writeJson(iam, deps.stateKey(ref.ownerId), state, saved.etag, saved.data === null);
            return;
        } catch (e) {
            if (e?.statusCode !== 409 || attempt === 4) throw e;
        }
    }
}

async function readVisibleDocuments(uid, iam, deps, index) {
    const documents = await Promise.all(
        index.memberships.map(async (membership) => {
            const ref = {kind: membership.kind, ownerId: membership.ownerId, id: membership.id};
            if (!KINDS.has(ref.kind) || !ref.ownerId || !ref.id) return null;
            const doc = await deps.readJson(iam, entityKey(ref.kind, ref.ownerId, ref.id));
            return doc && accessFor(doc, uid) ? doc : null;
        }),
    );
    return documents.filter(Boolean);
}

function collaborationMeta(identity, index) {
    return {
        user: {id: identity.id, email: identity.email || ''},
        notifications: [...index.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
        indexRevision: index.revision || 0,
        pushAvailable,
        pushPublicKey: pushAvailable ? VAPID_PUBLIC_KEY : null,
    };
}

async function repairOwnerEmail(doc, identity, iam, deps) {
    if (doc.ownerId !== identity.id || !identity.email || doc.ownerEmail === identity.email) return doc;
    const path = entityKey(doc.kind, doc.ownerId, doc.id);
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await deps.readJson(iam, path, true);
        const current = saved.data;
        if (!current || current.ownerEmail === identity.email) return current || doc;
        try {
            const next = {...current, ownerEmail: identity.email, revision: current.revision + 1, updatedAt: new Date().toISOString()};
            await deps.writeJson(iam, path, next, saved.etag, false);
            return next;
        } catch (e) {
            if (e?.statusCode !== 409 || attempt === 4) throw e;
        }
    }
    return doc;
}

async function workspace(identity, iam, deps, base = {}) {
    const index = (await readIndex(identity.id, iam, deps)).data;
    const visible = await readVisibleDocuments(identity.id, iam, deps, index);
    const docs = await Promise.all(visible.map((doc) => repairOwnerEmail(doc, identity, iam, deps)));
    return {
        ...base,
        ...collaborationMeta(identity, index),
        documents: docs.map((doc) => publicDocument(doc, identity.id)),
    };
}

async function saveEntity(req, identity, iam, deps) {
    const ref = checkRef(req, deps.fail);
    if (ref.ownerId !== identity.id && !req.update) throw deps.fail(400, 'bad_update');
    const update = req.update ? decodeUpdate(req.update, deps.fail) : null;
    const vector = req.stateVector ? decodeUpdate(req.stateVector, deps.fail) : undefined;
    const key = documentKey(ref.kind, ref.ownerId, ref.id);
    let result = null;

    for (let attempt = 0; attempt < 5; attempt++) {
        const path = entityKey(ref.kind, ref.ownerId, ref.id);
        const saved = await deps.readJson(iam, path, true);
        const existing = saved.data;
        if (!existing && ref.ownerId !== identity.id) throw deps.fail(404, 'not_found');
        if (existing && !accessFor(existing, identity.id)) throw deps.fail(403, 'access_denied');
        if (existing && update && accessFor(existing, identity.id) === 'view') throw deps.fail(403, 'read_only');
        const doc = openDocument(existing?.state, ref, deps.fail);
        const previousData = existing ? entityData(doc, ref, deps.fail) : null;
        if (update) Y.applyUpdate(doc, update);
        const data = entityData(doc, ref, deps.fail);
        if (ref.kind === 'roadmap') {
            const previousShare = previousData?.shareId ?? null;
            if ((data.shareId ?? null) !== previousShare) {
                const root = doc.getMap('entity').get('root');
                setText(root, 'shareId', previousShare);
                data.shareId = previousShare;
            }
        }
        const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
        const contentChanged = !existing || encoded !== existing.state;
        const emailChanged = Boolean(
            existing && ref.ownerId === identity.id && identity.email && existing.ownerEmail !== identity.email,
        );
        const changed = contentChanged || emailChanged;
        const next = existing
            ? {
                  ...existing,
                  ownerEmail: ref.ownerId === identity.id ? identity.email || existing.ownerEmail || '' : existing.ownerEmail || '',
              }
            : {
                  version: 1,
                  ...ref,
                  ownerEmail: identity.email || '',
                  revision: 0,
                  members: {},
                  createdAt: new Date().toISOString(),
              };
        if (changed) {
            next.state = encoded;
            next.revision = (Number(existing?.revision) || 0) + 1;
            next.updatedAt = new Date().toISOString();
            try {
                await deps.writeJson(iam, path, next, saved.etag, saved.data === null);
            } catch (e) {
                if (e?.statusCode === 409 && attempt < 4) continue;
                throw e;
            }
            await addMembership(ref.ownerId, ref, iam, deps);
            if (contentChanged) await mirrorEntity(ref, data, iam, deps);
        }
        const diff = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64');
        result = {document: publicDocument(next, identity.id, diff), key};
        break;
    }
    if (!result) throw deps.fail(409, 'state_conflict');
    return result;
}

async function setAccess(req, identity, iam, deps) {
    const ref = checkRef(req, deps.fail);
    const email = deps.normEmail(req.email);
    const access = String(req.access || '');
    if (!['view', 'edit'].includes(access)) throw deps.fail(400, 'bad_access');
    if (ref.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
    const account = await deps.readJson(iam, deps.accountKey(email));
    if (!account) throw deps.fail(404, 'user_not_found');
    if (account.id === identity.id) throw deps.fail(400, 'cannot_share_with_self');
    const path = entityKey(ref.kind, ref.ownerId, ref.id);
    let shared = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await deps.readJson(iam, path, true);
        const doc = saved.data;
        if (!doc) throw deps.fail(404, 'not_found');
        if (doc.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
        const before = doc.members?.[account.id]?.access;
        if (before === access) return {document: publicDocument(doc, identity.id)};
        const title = entityData(openDocument(doc.state, ref, deps.fail), ref, deps.fail).title;
        const next = {
            ...doc,
            revision: doc.revision + 1,
            updatedAt: new Date().toISOString(),
            members: {
                ...(doc.members || {}),
                [account.id]: {email: account.email, access, addedAt: new Date().toISOString()},
            },
        };
        try {
            await deps.writeJson(iam, path, next, saved.etag, false);
        } catch (e) {
            if (e?.statusCode === 409 && attempt < 4) continue;
            throw e;
        }
        shared = {doc: next, title, previousAccess: before};
        break;
    }
    if (!shared) throw deps.fail(409, 'state_conflict');
    const key = documentKey(ref.kind, ref.ownerId, ref.id);
    await mutateIndex(account.id, iam, deps, (index) => {
        if (!index.memberships.some((item) => item.key === key)) index.memberships.push({key, ...ref});
        const notification = {
            id: crypto.randomUUID(),
            type: 'shared',
            kind: ref.kind,
            entityId: ref.id,
            ownerId: ref.ownerId,
            ownerEmail: identity.email || '',
            title: shared.title,
            access,
            createdAt: new Date().toISOString(),
            readAt: null,
        };
        index.notifications = [notification, ...index.notifications].slice(0, 100);
        shared.notification = notification;
    });
    await sendPush(account.id, shared.notification, iam, deps);
    return {document: publicDocument(shared.doc, identity.id)};
}

async function removeAccess(req, identity, iam, deps, leave = false) {
    const ref = checkRef(req, deps.fail);
    const userId = leave ? identity.id : String(req.userId || '');
    if (!leave && ref.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
    if (leave && ref.ownerId === identity.id) throw deps.fail(400, 'owner_cannot_leave');
    if (!/^[\w-]{1,128}$/.test(userId)) throw deps.fail(400, 'bad_user');
    const path = entityKey(ref.kind, ref.ownerId, ref.id);
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await deps.readJson(iam, path, true);
        const doc = saved.data;
        if (!doc) return {ok: true};
        if (!leave && doc.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
        if (leave && !doc.members?.[identity.id]) throw deps.fail(404, 'not_found');
        if (!doc.members?.[userId]) return {ok: true};
        const next = {...doc, revision: doc.revision + 1, updatedAt: new Date().toISOString(), members: {...doc.members}};
        delete next.members[userId];
        try {
            await deps.writeJson(iam, path, next, saved.etag, false);
        } catch (e) {
            if (e?.statusCode === 409 && attempt < 4) continue;
            throw e;
        }
        await removeMembership(userId, documentKey(ref.kind, ref.ownerId, ref.id), iam, deps);
        return {ok: true};
    }
    throw deps.fail(409, 'state_conflict');
}

async function removeEntity(req, identity, iam, deps) {
    const ref = checkRef(req, deps.fail);
    if (ref.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
    const path = entityKey(ref.kind, ref.ownerId, ref.id);
    const doc = await deps.readJson(iam, path);
    if (doc && doc.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
    if (doc?.kind === 'roadmap' && doc.state) {
        const data = entityData(openDocument(doc.state, ref, deps.fail), ref, deps.fail);
        if (data.shareId) await deps.deleteKey(iam, deps.shareKey(data.shareId));
    }
    await deps.deleteKey(iam, path);
    const key = documentKey(ref.kind, ref.ownerId, ref.id);
    await removeMembership(identity.id, key, iam, deps);
    for (const userId of Object.keys(doc?.members || {})) await removeMembership(userId, key, iam, deps);
    await mirrorEntity(ref, null, iam, deps);
    return {ok: true, key};
}

async function markRead(req, identity, iam, deps) {
    const ids = Array.isArray(req.ids) ? new Set(req.ids.map(String)) : null;
    await mutateIndex(identity.id, iam, deps, (index) => {
        let changed = false;
        const at = new Date().toISOString();
        index.notifications = index.notifications.map((item) => {
            if (item.readAt || (ids && !ids.has(item.id))) return item;
            changed = true;
            return {...item, readAt: at};
        });
        return changed ? undefined : false;
    });
    return {ok: true};
}

async function pushSubscribe(req, identity, iam, deps) {
    if (!pushAvailable) throw deps.fail(400, 'push_disabled');
    const subscription = req.subscription;
    const endpoint = String(subscription?.endpoint || '');
    const p256dh = String(subscription?.keys?.p256dh || '');
    const auth = String(subscription?.keys?.auth || '');
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw deps.fail(400, 'bad_subscription');
    await mutateIndex(identity.id, iam, deps, (index) => {
        const next = {endpoint, keys: {p256dh, auth}, expirationTime: subscription.expirationTime || null};
        const current = index.subscriptions.find((item) => item.endpoint === endpoint);
        if (current) Object.assign(current, next);
        else index.subscriptions.push({id: crypto.randomUUID(), ...next});
        index.subscriptions = index.subscriptions.slice(-10);
    });
    return {ok: true};
}

async function pushUnsubscribe(req, identity, iam, deps) {
    const endpoint = String(req.endpoint || '');
    await mutateIndex(identity.id, iam, deps, (index) => {
        index.subscriptions = index.subscriptions.filter((item) => item.endpoint !== endpoint);
    });
    return {ok: true};
}

async function sendPush(uid, notification, iam, deps) {
    if (!pushAvailable || !notification) return;
    const index = (await readIndex(uid, iam, deps)).data;
    const payload = JSON.stringify({
        title: 'Вам открыли доступ в Муравее',
        body: `${notification.ownerEmail || 'Пользователь'}: «${notification.title}»`,
        tag: notification.id,
        url: `/#${notification.kind === 'product' ? 'products' : notification.kind === 'roadmap' ? 'roadmap' : 'stakeholders'}/${notification.entityId}`,
    });
    for (const subscription of index.subscriptions) {
        try {
            await webpush.sendNotification(subscription, payload, {TTL: 24 * 3600});
        } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
                await mutateIndex(uid, iam, deps, (current) => {
                    current.subscriptions = current.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
                });
            } else {
                console.error('web push', e.statusCode || e.message);
            }
        }
    }
}

async function sync(req, identity, iam, deps) {
    const requested = new Map();
    for (const item of Array.isArray(req.documents) ? req.documents.slice(0, 200) : []) {
        const ref = checkRef(item, deps.fail);
        requested.set(documentKey(ref.kind, ref.ownerId, ref.id), {
            ...ref,
            revision: Number(item.revision) || 0,
            stateVector: item.stateVector ? decodeUpdate(item.stateVector, deps.fail) : undefined,
        });
    }
    const started = Date.now();
    do {
        const index = (await readIndex(identity.id, iam, deps)).data;
        const visible = await readVisibleDocuments(identity.id, iam, deps, index);
        const visibleKeys = new Set(visible.map((doc) => documentKey(doc.kind, doc.ownerId, doc.id)));
        const removed = [...requested.keys()].filter((key) => !visibleKeys.has(key));
        const documents = [];
        for (const doc of visible) {
            const key = documentKey(doc.kind, doc.ownerId, doc.id);
            const previous = requested.get(key);
            if (previous && previous.revision >= doc.revision) continue;
            const ydoc = openDocument(doc.state, doc, deps.fail);
            const diff = Buffer.from(Y.encodeStateAsUpdate(ydoc, previous?.stateVector)).toString('base64');
            documents.push(publicDocument(doc, identity.id, diff));
        }
        const indexChanged = Number(req.indexRevision) !== Number(index.revision || 0);
        if (documents.length || removed.length || indexChanged || Date.now() - started >= WAIT_MS) {
            return {documents, removed, ...collaborationMeta(identity, index)};
        }
        await sleep(POLL_MS);
    } while (Date.now() - started < WAIT_MS + POLL_MS);
    return {documents: [], removed: [], ...collaborationMeta(identity, (await readIndex(identity.id, iam, deps)).data)};
}

async function replaceOwnedDocument(ref, data, identity, iam, deps) {
    const path = entityKey(ref.kind, ref.ownerId, ref.id);
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await deps.readJson(iam, path, true);
        const doc = saved.data;
        if (!doc) return;
        if (doc.ownerId !== identity.id) throw deps.fail(403, 'owner_only');
        const ydoc = openDocument(doc.state, ref, deps.fail);
        ydoc.transact(() => ydoc.getMap('entity').set('root', encodeJson(data)));
        entityData(ydoc, ref, deps.fail);
        try {
            await deps.writeJson(iam, path, {
                ...doc,
                state: Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64'),
                revision: doc.revision + 1,
                updatedAt: new Date().toISOString(),
            }, saved.etag, false);
            return;
        } catch (e) {
            if (e?.statusCode !== 409 || attempt === 4) throw e;
        }
    }
}

async function syncLegacyState(req, identity, iam, deps, state) {
    if (!['import', 'restoreBackup'].includes(req.action)) return;
    const groups = [
        ['roadmap', 'roadmaps'],
        ['product', 'products'],
        ['stakeholderMap', 'stakeholders'],
    ];
    const index = (await readIndex(identity.id, iam, deps)).data;
    for (const [kind, field] of groups) {
        const source = req.action === 'import' && Array.isArray(req[field]) ? req[field] : state[field] || [];
        const items = source.map((item) => state[field].find((current) => current.id === item?.id) || item);
        for (const item of items) {
            if (!item || typeof item.id !== 'string') continue;
            const ref = {kind, ownerId: identity.id, id: item.id};
            const existing = index.memberships.some((member) => member.kind === kind && member.ownerId === identity.id && member.id === item.id);
            if (existing) await replaceOwnedDocument(ref, item, identity, iam, deps);
        }
        if (req.action === 'restoreBackup') {
            const keep = new Set(items.map((item) => item.id));
            const owned = index.memberships.filter((member) => member.kind === kind && member.ownerId === identity.id && !keep.has(member.id));
            for (const ref of owned) await removeEntity({...ref}, identity, iam, deps);
        }
    }
}

async function updatePublicShare(req, identity, iam, deps, state) {
    if (!['shareRoadmap', 'unshareRoadmap', 'removeRoadmap'].includes(req.action)) return;
    const id = String(req.id || '');
    if (!/^[\w-]{1,128}$/.test(id)) return;
    const ref = {kind: 'roadmap', ownerId: identity.id, id};
    const path = entityKey(ref.kind, ref.ownerId, ref.id);
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await deps.readJson(iam, path, true);
        const doc = saved.data;
        if (!doc || doc.ownerId !== identity.id) return;
        const roadmap = state.roadmaps.find((item) => item.id === id);
        const ydoc = openDocument(doc.state, ref, deps.fail);
        const root = ydoc.getMap('entity').get('root');
        ydoc.transact(() => setText(root, 'shareId', roadmap?.shareId ?? null));
        const encoded = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64');
        if (encoded === doc.state) return;
        try {
            await deps.writeJson(iam, path, {
                ...doc,
                state: encoded,
                revision: doc.revision + 1,
                updatedAt: new Date().toISOString(),
            }, saved.etag, false);
            return;
        } catch (e) {
            if (e?.statusCode !== 409 || attempt === 4) throw e;
        }
    }
}

async function handle(req, identity, iam, deps) {
    switch (req.action) {
        case 'saveEntity':
            return saveEntity(req, identity, iam, deps);
        case 'sync':
            return sync(req, identity, iam, deps);
        case 'setEntityAccess':
            return setAccess(req, identity, iam, deps);
        case 'removeEntityAccess':
            return removeAccess(req, identity, iam, deps);
        case 'leaveEntity':
            return removeAccess(req, identity, iam, deps, true);
        case 'removeEntity':
            return removeEntity(req, identity, iam, deps);
        case 'markNotificationsRead':
            return markRead(req, identity, iam, deps);
        case 'pushSubscribe':
            return pushSubscribe(req, identity, iam, deps);
        case 'pushUnsubscribe':
            return pushUnsubscribe(req, identity, iam, deps);
        default:
            return null;
    }
}

module.exports = {handle, workspace, updatePublicShare, syncLegacyState};
