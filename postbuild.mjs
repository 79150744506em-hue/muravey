// Превращает dist/index.html в тело артефакта: без doctype/html/head/body.
import fs from 'node:fs';
const src = fs.readFileSync('dist/index.html', 'utf8');
const head = src.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = src.match(/<body>([\s\S]*?)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const rest = head.replace(title, '').replace(/<meta[^>]*>/g, '');
fs.writeFileSync('dist/muravey.html', `${title}\n${rest}\n${body}\n`);
