#!/usr/bin/env node
// Авто-перевод недостающих ключей RU-локали через OpenAI-совместимый API.
//
//   node i18n-translate.mjs <messages_dir> <patches_dir>
//
// <patches_dir> — каталог patches/ru-locale (ru.ts, ru.settings.ts).
//
// Окружение (всё через Секреты репозитория):
//   TRANSLATE_API_KEY   — Bearer-токен (или токен OpenAI-совместимого провайдера)
//   TRANSLATE_API_USER  — логин для Basic-авторизации (вместе с PASS)
//   TRANSLATE_API_PASS  — пароль для Basic-авторизации
//   TRANSLATE_API_BASE  — URL эндпоинта, например https://api.openai.com/v1
//                         или http://IP:ПОРТ/v1 (Ollama/локальный сервер)
//   TRANSLATE_MODEL     — модель, по умолчанию gpt-4o-mini
//
// Выход: 0 — всё покрыто (или переводы добавлены), 1 — есть пропуски и ключа нет.
import fs from 'node:fs';
import path from 'node:path';

const messagesDir = process.argv[2];
const patchesDir = process.argv[3];
if (!messagesDir || !patchesDir) {
  console.error('usage: node i18n-translate.mjs <messages_dir> <patches_dir>');
  process.exit(2);
}

const read = (p) => fs.readFileSync(p, 'utf8');
const keyRe = /^[\t ]*'([\w.]+)'\s*:\s*(.*),\s*$/gm;

function load(text) {
  const out = {};
  for (const m of text.matchAll(keyRe)) out[m[1]] = m[2].trim();
  return out;
}

const IGNORED = new Set(['onboarding.localSetup.windows.stepInstallWslSuffix']);

const enMain = load(read(path.join(messagesDir, 'en.ts')));
const enSet = load(read(path.join(messagesDir, 'en.settings.ts')));
const ruPath = path.join(patchesDir, 'ru.ts');
const ruSetPath = path.join(patchesDir, 'ru.settings.ts');
const ruMain = load(read(ruPath));
const ruSet = load(read(ruSetPath));

const missingMain = Object.keys(enMain).filter((k) => !(k in ruMain) && !IGNORED.has(k));
const missingSet = Object.keys(enSet).filter((k) => !(k in ruSet) && !IGNORED.has(k));

if (missingMain.length === 0 && missingSet.length === 0) {
  const ru = load(read(ruPath));
  const rs = load(read(ruSetPath));
  const settingsExtras = Object.keys(rs).filter((k) => !(k in enSet) && !k.includes('settings.'));
  console.log(`i18n-translate: пропусков нет (RU ${Object.keys(ru).length} + settings ${Object.keys(rs).length}).`);
  if (settingsExtras.length) console.warn(`  settings-EXTRAS (свой, не из settings): ${settingsExtras.join(', ')}`);
  process.exit(0);
}

const groups = [
  ['main', missingMain, enMain, ruPath],
  ['settings', missingSet, enSet, ruSetPath],
].filter(([, keys]) => keys.length > 0);

const payload = {};
for (const [, keys, en, ] of groups) for (const k of keys) payload[k] = en[k];

console.log(`i18n-translate: пропусков ${missingMain.length} (main) + ${missingSet.length} (settings).`);

const apiKey = process.env.TRANSLATE_API_KEY;
const apiUser = process.env.TRANSLATE_API_USER;
const apiPass = process.env.TRANSLATE_API_PASS;
if (!apiKey && !apiPass) {
  console.error(`::error::Нет доступа к LLM (TRANSLATE_API_KEY или TRANSLATE_API_USER/PASS). Переведите вручную ${missingMain.length + missingSet.length} ключей: ${Object.keys(payload).slice(0, 50).join(', ')}`);
  process.exit(1);
}

const base = process.env.TRANSLATE_API_BASE || 'https://api.openai.com/v1';
const model = process.env.TRANSLATE_MODEL || 'gpt-4o-mini';

let headers = { 'Content-Type': 'application/json' };
if (apiPass) headers.Authorization = 'Basic ' + Buffer.from(`${apiUser || ''}:${apiPass}`).toString('base64');
else headers.Authorization = `Bearer ${apiKey}`;

const prompt = `Ты — переводчик интерфейса OpenChamber на русский язык. Переведи значения на русский. Сохрани все плейсхолдеры вида {foo} без изменений. Соблюдай терминологию: сессия (не «сеанс»), рабочее дерево (worktree), субагент, MCP-сервер, коммит, ветка, OpenCode/OpenChamber — латиницей, обращение на «вы». Верни ТОЛЬКО JSON-объект с теми же ключами и переведёнными значениями. Не добавляй код-фенсы.

${JSON.stringify(payload, null, 2)}`;

let json;
try {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    console.error(`::error::LLM ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  json = JSON.parse(content.replace(/```json|```/g, '').trim());
} catch (e) {
  console.error(`::error::ошибка LLM: ${e.message}`);
  process.exit(1);
}

const unquotedFix = (v) => v.replace(/^'(.*)'$/s, "$1");
let anyWrite = false;

for (const [, keys, , filePath] of groups) {
  const lines = [];
  for (const k of keys) {
    const v = json[k];
    if (typeof v !== 'string' || !v.trim()) {
      console.warn(`  ! нет перевода для ${k}`);
      continue;
    }
    const clean = unquotedFix(v).trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`  '${k}': '${clean}',`);
  }
  if (!lines.length) continue;
  let text = read(filePath);
  const marker = filePath.endsWith('ru.ts') ? '\n};' : '\n  ...linearIntegrationI18n.ru,';
  const idx = text.lastIndexOf(marker);
  if (idx < 0) throw new Error(`маркер не найден в ${filePath}`);
  text = text.slice(0, idx) + '\n' + lines.join('\n') + marker + text.slice(idx + marker.length);
  fs.writeFileSync(filePath, text);
  anyWrite = true;
  console.log(`  ✓ обновлён ${path.basename(filePath)} (+${lines.length} ключей)`);
}

console.log(anyWrite ? 'i18n-translate: готово.' : 'i18n-translate: добавить нечего.');
process.exit(0);