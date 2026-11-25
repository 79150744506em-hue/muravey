// Локальная имитация API-шлюза: npm run build && node scripts/dev-server.cjs (секрет входа «секрет, 1»).
const http = require('http');
const fs = require('fs');
const path = require('path');
process.env.BUCKET = 'b';
process.env.MURAVEY_PASSWORD_B64 = Buffer.from('секрет, 1').toString('base64');
const store = new Map();
let nextEtag = 1;
const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: {get: (name) => (name.toLowerCase() === 'etag' ? body?.etag ?? null : null)},
});
global.fetch = async (url, opts = {}) => {
    const key = url;
    const method = opts.method || 'GET';
    const current = store.get(key);
    if (method === 'PUT') {
        if (opts.headers?.['If-Match'] && opts.headers['If-Match'] !== current?.etag) return response(412, 'conflict');
        if (opts.headers?.['If-None-Match'] === '*' && current) return response(412, 'conflict');
        const etag = `"${nextEtag++}"`;
        store.set(key, {body: opts.body, etag});
        return response(200, '');
    }
    if (method === 'DELETE') {
        store.delete(key);
        return response(204, '');
    }
    if (!current) return response(404, 'not found');
    return {...response(200, current.body), headers: {get: (name) => (name.toLowerCase() === 'etag' ? current.etag : null)}};
};
const {handler} = require('../api/index.js');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
};
http.createServer(async (req, res) => {
    const pathname = req.url.split('?')[0];
    if (req.url === '/api' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const result = await handler({body, headers: req.headers, isBase64Encoded: false}, {token: {access_token: 'x'}});
        res.writeHead(result.statusCode, result.headers);
        return res.end(result.body);
    }
    if (req.method === 'GET') {
        const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
        const file = path.join(__dirname, '..', 'dist', filename);
        if (file.startsWith(path.join(__dirname, '..', 'dist')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
            return res.end(fs.readFileSync(file));
        }
    }
    res.statusCode = 404;
    res.end();
}).listen(8787, () => console.log('Муравей: http://localhost:8787'));
