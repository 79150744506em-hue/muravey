// Собирает Android-проект (Trusted Web Activity) из android/twa-manifest.json.
// Иконки берутся из собранного dist/, который раздаёт локальный сервер на порту 8765 (см. workflow).
// Использование: node android/generate.mjs <папка проекта> <номер версии>
import {TwaGenerator, TwaManifest, ConsoleLog} from '@bubblewrap/core';

const [dir, version] = process.argv.slice(2);
const manifest = await TwaManifest.fromFile(new URL('./twa-manifest.json', import.meta.url).pathname);
manifest.appVersionCode = Number(version) || 1;
manifest.appVersionName = `1.0.${manifest.appVersionCode}`;
const error = manifest.validate();
if (error) throw new Error(error);
await new TwaGenerator().createTwaProject(dir, manifest, new ConsoleLog('twa'));
