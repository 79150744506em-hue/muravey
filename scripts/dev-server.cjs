// Локальная имитация API-шлюза для разработки: npm run build && node scripts/dev-server.cjs (пароль «секрет, 1»)
const http = require('http'); const fs = require('fs');
process.env.BUCKET = 'b'; process.env.MURAVEY_PASSWORD_B64 = Buffer.from('секрет, 1').toString('base64');
const store = {};
global.fetch = async (url, opts = {}) => {
  const k = url; const m = opts.method || 'GET';
  if (m === 'PUT') { store[k] = opts.body; return {ok: true, status: 200, text: async () => ''}; }
  if (!(k in store)) return {ok: false, status: 404, text: async () => 'nf'};
  return {ok: true, status: 200, json: async () => JSON.parse(store[k])};
};
const {handler} = require('../api/index.js');
http.createServer(async (req, res) => {
  if (req.url === '/' && req.method === 'GET') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync('dist/index.html')); }
  if (req.url === '/api' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const r = await handler({body, headers: req.headers, isBase64Encoded: false}, {token: {access_token: 'x'}});
    res.writeHead(r.statusCode, r.headers); return res.end(r.body);
  }
  res.statusCode = 404; res.end();
}).listen(8787, () => console.log('up'));
