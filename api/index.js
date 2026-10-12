// Серверная часть Муравья: одна функция Yandex Cloud Functions за API-шлюзом.
// Данные лежат одним JSON-файлом в Object Storage: {tasks: [], tags: []}.
const crypto = require('node:crypto');

const BUCKET = process.env.BUCKET;
const PASSWORD = Buffer.from(process.env.MURAVEY_PASSWORD_B64 || '', 'base64').toString('utf8');
const STATE_KEY = 'data/state.json';
const STORAGE = 'https://storage.yandexcloud.net';

const tokenFor = () =>
    crypto.createHmac('sha256', crypto.createHash('sha256').update('muravey:' + PASSWORD).digest()).update('v1').digest('hex');

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function reply(statusCode, body) {
    return {
        statusCode,
        headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'},
        body: JSON.stringify(body),
    };
}

async function readState(iam) {
    const res = await fetch(`${STORAGE}/${BUCKET}/${STATE_KEY}`, {headers: {'X-YaCloud-SubjectToken': iam}});
    if (res.status === 404) return {tasks: [], tags: []};
    if (!res.ok) throw new Error(`storage read ${res.status}: ${await res.text()}`);
    return res.json();
}

async function writeState(iam, state) {
    const res = await fetch(`${STORAGE}/${BUCKET}/${STATE_KEY}`, {
        method: 'PUT',
        headers: {'X-YaCloud-SubjectToken': iam, 'Content-Type': 'application/json'},
        body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error(`storage write ${res.status}: ${await res.text()}`);
}

const upsert = (arr, item) => {
    const i = arr.findIndex((x) => x.id === item.id);
    return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string';

module.exports.handler = async function (event, context) {
    let req = {};
    try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
        req = JSON.parse(raw || '{}');
    } catch {
        return reply(400, {error: 'bad_json'});
    }

    if (!PASSWORD || !BUCKET) return reply(500, {error: 'not_configured'});

    if (req.action === 'ping') return reply(200, {ok: true});

    if (req.action === 'login') {
        if (!safeEqual(req.password || '', PASSWORD)) return reply(401, {error: 'wrong_password'});
        return reply(200, {token: tokenFor()});
    }

    const headers = event.headers || {};
    const auth = headers.Authorization || headers.authorization || '';
    if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), tokenFor())) return reply(401, {error: 'unauthorized'});

    const iam = context && context.token && context.token.access_token;
    if (!iam) return reply(500, {error: 'no_service_account'});

    try {
        if (req.action === 'state') return reply(200, await readState(iam));

        const state = await readState(iam);
        switch (req.action) {
            case 'saveTask':
                if (!isObj(req.item)) return reply(400, {error: 'bad_item'});
                state.tasks = upsert(state.tasks, req.item);
                break;
            case 'removeTask':
                state.tasks = state.tasks.filter((t) => t.id !== req.id);
                break;
            case 'saveTag':
                if (!isObj(req.item)) return reply(400, {error: 'bad_item'});
                state.tags = upsert(state.tags, req.item);
                break;
            case 'removeTag':
                state.tags = state.tags.filter((t) => t.id !== req.id);
                break;
            case 'import':
                if (!Array.isArray(req.tasks) || !Array.isArray(req.tags)) return reply(400, {error: 'bad_import'});
                for (const t of req.tasks) if (isObj(t)) state.tasks = upsert(state.tasks, t);
                for (const t of req.tags) if (isObj(t)) state.tags = upsert(state.tags, t);
                break;
            default:
                return reply(400, {error: 'unknown_action'});
        }
        await writeState(iam, state);
        return reply(200, state);
    } catch (e) {
        console.error(e);
        return reply(502, {error: 'storage_error'});
    }
};
