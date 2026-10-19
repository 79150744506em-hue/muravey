// Серверная часть Муравья: одна функция Yandex Cloud Functions за API-шлюзом.
// Данные лежат в Object Storage:
//   accounts/<sha256 почты>.json — аккаунт {id, email, pass?, google?}
//   users/<id>/state.json        — задачи и теги пользователя {tasks: [], tags: []}
const crypto = require('node:crypto');

const BUCKET = process.env.BUCKET;
// Секрет для подписи ключей входа (секрет MURAVEY_PASSWORD в GitHub)
const SECRET = Buffer.from(process.env.MURAVEY_PASSWORD_B64 || '', 'base64').toString('utf8');
// Идентификатор клиента Google OAuth; без него вход через Google скрыт
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const STORAGE = 'https://storage.yandexcloud.net';
// Ключ входа живёт месяц и продлевается при каждом открытии сайта
const TOKEN_TTL = 30 * 24 * 3600;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', 'muravey:v2:' + SECRET).update(data).digest('base64url');

function issueToken(uid) {
    const body = b64url(JSON.stringify({u: uid, x: Math.floor(Date.now() / 1000) + TOKEN_TTL}));
    return `${body}.${sign(body)}`;
}

function readToken(token) {
    const [body, sig] = String(token).split('.');
    if (!body || !sig || !safeEqual(sig, sign(body))) return null;
    try {
        const {u, x} = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        return typeof u === 'string' && x > Date.now() / 1000 ? u : null;
    } catch {
        return null;
    }
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const scrypt = (password, salt) =>
    new Promise((resolve, reject) =>
        crypto.scrypt(password, salt, 32, (e, key) => (e ? reject(e) : resolve(key.toString('base64url')))),
    );

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('base64url');
    return `${salt}:${await scrypt(password, salt)}`;
}

async function checkPassword(password, stored) {
    const [salt, hash] = String(stored || '').split(':');
    return Boolean(salt && hash) && safeEqual(await scrypt(password, salt), hash);
}

function reply(statusCode, body) {
    return {
        statusCode,
        headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'},
        body: JSON.stringify(body),
    };
}

const fail = (statusCode, error) => Object.assign(new Error(error), {statusCode});

async function readJson(iam, key) {
    const res = await fetch(`${STORAGE}/${BUCKET}/${key}`, {headers: {'X-YaCloud-SubjectToken': iam}});
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage read ${res.status}: ${await res.text()}`);
    return res.json();
}

async function writeJson(iam, key, value) {
    const res = await fetch(`${STORAGE}/${BUCKET}/${key}`, {
        method: 'PUT',
        headers: {'X-YaCloud-SubjectToken': iam, 'Content-Type': 'application/json'},
        body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error(`storage write ${res.status}: ${await res.text()}`);
}

const normEmail = (email) => String(email || '').trim().toLowerCase();
const accountKey = (email) => `accounts/${crypto.createHash('sha256').update(email).digest('hex')}.json`;
const stateKey = (uid) => `users/${uid}/state.json`;

/* ---------- вход через Google: проверяем id_token по открытым ключам Google ---------- */

let googleKeys = {at: 0, keys: []};

async function googleKey(kid) {
    if (Date.now() - googleKeys.at > 3600_000 || !googleKeys.keys.some((k) => k.kid === kid)) {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
        if (!res.ok) throw new Error(`google certs ${res.status}`);
        googleKeys = {at: Date.now(), keys: (await res.json()).keys};
    }
    const jwk = googleKeys.keys.find((k) => k.kid === kid);
    return jwk && crypto.createPublicKey({key: jwk, format: 'jwk'});
}

async function verifyGoogle(idToken, nonce) {
    const [h, p, s] = String(idToken || '').split('.');
    if (!h || !p || !s) throw fail(401, 'bad_google_token');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    const key = header.alg === 'RS256' && (await googleKey(header.kid));
    if (!key || !crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
        throw fail(401, 'bad_google_token');
    }
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    const ok =
        ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) &&
        claims.aud === GOOGLE_CLIENT_ID &&
        claims.exp > Date.now() / 1000 &&
        nonce &&
        claims.nonce === nonce &&
        claims.email &&
        claims.email_verified === true;
    if (!ok) throw fail(401, 'bad_google_token');
    return {email: normEmail(claims.email), sub: claims.sub};
}

/* ---------- задачи ---------- */

const upsert = (arr, item) => {
    const i = arr.findIndex((x) => x.id === item.id);
    return i === -1 ? [...arr, item] : arr.map((x) => (x.id === item.id ? item : x));
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string';

async function handle(req, headers, iam) {
    if (req.action === 'ping') return {ok: true, google: GOOGLE_CLIENT_ID || undefined};

    if (req.action === 'signup') {
        const email = normEmail(req.email);
        if (!/^\S+@\S+\.\S+$/.test(email)) throw fail(400, 'bad_email');
        if (String(req.password || '').length < 6) throw fail(400, 'weak_password');
        if (await readJson(iam, accountKey(email))) throw fail(409, 'user_already_exists');
        const account = {id: crypto.randomUUID(), email, pass: await hashPassword(req.password), createdAt: Date.now()};
        await writeJson(iam, accountKey(email), account);
        return {token: issueToken(account.id)};
    }

    if (req.action === 'login') {
        const account = await readJson(iam, accountKey(normEmail(req.email)));
        if (!account || !(await checkPassword(String(req.password || ''), account.pass))) throw fail(401, 'wrong_password');
        return {token: issueToken(account.id)};
    }

    if (req.action === 'google') {
        if (!GOOGLE_CLIENT_ID) throw fail(400, 'google_disabled');
        const {email, sub} = await verifyGoogle(req.idToken, req.nonce);
        // почта подтверждена Google, поэтому вход через Google открывает и аккаунт, созданный по паролю
        let account = await readJson(iam, accountKey(email));
        if (!account) {
            account = {id: crypto.randomUUID(), email, google: sub, createdAt: Date.now()};
            await writeJson(iam, accountKey(email), account);
        } else if (account.google !== sub) {
            account = {...account, google: sub};
            await writeJson(iam, accountKey(email), account);
        }
        return {token: issueToken(account.id)};
    }

    const auth = headers.Authorization || headers.authorization || '';
    const uid = readToken(auth.replace(/^Bearer\s+/i, ''));
    if (!uid) throw fail(401, 'unauthorized');

    const state = (await readJson(iam, stateKey(uid))) || {tasks: [], tags: []};
    if (req.action === 'state') return {...state, token: issueToken(uid)};

    switch (req.action) {
        case 'saveTask':
            if (!isObj(req.item)) throw fail(400, 'bad_item');
            state.tasks = upsert(state.tasks, req.item);
            break;
        case 'removeTask':
            state.tasks = state.tasks.filter((t) => t.id !== req.id);
            break;
        case 'saveTag':
            if (!isObj(req.item)) throw fail(400, 'bad_item');
            state.tags = upsert(state.tags, req.item);
            break;
        case 'removeTag':
            state.tags = state.tags.filter((t) => t.id !== req.id);
            break;
        case 'import':
            if (!Array.isArray(req.tasks) || !Array.isArray(req.tags)) throw fail(400, 'bad_import');
            for (const t of req.tasks) if (isObj(t)) state.tasks = upsert(state.tasks, t);
            for (const t of req.tags) if (isObj(t)) state.tags = upsert(state.tags, t);
            break;
        default:
            throw fail(400, 'unknown_action');
    }
    await writeJson(iam, stateKey(uid), state);
    return state;
}

module.exports.handler = async function (event, context) {
    let req = {};
    try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
        req = JSON.parse(raw || '{}');
    } catch {
        return reply(400, {error: 'bad_json'});
    }

    if (!SECRET || !BUCKET) return reply(500, {error: 'not_configured'});

    const iam = context && context.token && context.token.access_token;
    if (!iam) return reply(500, {error: 'no_service_account'});

    try {
        return reply(200, await handle(req, event.headers || {}, iam));
    } catch (e) {
        if (e.statusCode) return reply(e.statusCode, {error: e.message});
        console.error(e);
        return reply(502, {error: 'storage_error'});
    }
};
