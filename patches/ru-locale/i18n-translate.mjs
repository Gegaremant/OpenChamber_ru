#!/usr/bin/env node
// Авто-перевод недостающих ключей RU-локали через OpenAI-совместимый API.
//
//   node i18n-translate.mjs <messages_dir> <patches_dir>
//
// <messages_dir> — каталог словарей апстрима (packages/ui/src/lib/i18n/messages).
// <patches_dir>  — каталог patches/ru-locale (ru.ts, ru.settings.ts, *.i18n.ts).
//
// Окружение (всё через Секреты репозитория):
//   TRANSLATE_API_KEY   — Bearer-токен (или токен OpenAI-совместимого провайдера)
//   TRANSLATE_API_USER  — логин для Basic-авторизации (вместе с PASS)
//   TRANSLATE_API_PASS  — пароль для Basic-авторизации
//   TRANSLATE_API_BASE  — URL эндпоинта, например https://api.openai.com/v1
//                         или http://IP:ПОРТ/v1 (Ollama/локальный сервер)
//   TRANSLATE_MODEL              — основная модель, по умолчанию gpt-4o-mini
//   TRANSLATE_FALLBACK_MODEL     — резервная модель (допереводит пропущенное)
//   TRANSLATE_RESERVE_MODEL      — запасная модель (последняя линия)
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

const groups = [
  ['main', missingMain, enMain, ruPath],
  ['settings', missingSet, enSet, ruSetPath],
].filter(([, keys]) => keys.length > 0);

const payload = {};
for (const [, keys, en] of groups) for (const k of keys) payload[k] = en[k];

console.log(`i18n-translate: пропусков ${missingMain.length} (main) + ${missingSet.length} (settings).`);

const apiKey = process.env.TRANSLATE_API_KEY;
const apiUser = process.env.TRANSLATE_API_USER;
const apiPass = process.env.TRANSLATE_API_PASS;
const needLLM = Object.keys(payload).length > 0 || true; // линейные модули тоже переводятся
if (!apiKey && !apiPass) {
  if (Object.keys(payload).length) {
    console.error(`::error::Нет доступа к LLM (TRANSLATE_API_KEY или TRANSLATE_API_USER/PASS). Переведите вручную ${missingMain.length + missingSet.length} ключей: ${Object.keys(payload).slice(0, 50).join(', ')}`);
    process.exit(1);
  }
  console.error('::error::Нет доступа к LLM (TRANSLATE_API_KEY или TRANSLATE_API_USER/PASS).');
  process.exit(1);
}

const base = process.env.TRANSLATE_API_BASE || 'https://api.openai.com/v1';

const models = [process.env.TRANSLATE_MODEL || 'gpt-4o-mini'];
if (process.env.TRANSLATE_FALLBACK_MODEL) models.push(process.env.TRANSLATE_FALLBACK_MODEL);
if (process.env.TRANSLATE_RESERVE_MODEL) models.push(process.env.TRANSLATE_RESERVE_MODEL);

let headers = { 'Content-Type': 'application/json' };
if (apiPass) headers.Authorization = 'Basic ' + Buffer.from(`${apiUser || ''}:${apiPass}`).toString('base64');
else headers.Authorization = `Bearer ${apiKey}`;

const unquotedFix = (v) => String(v).replace(/^'(.*)'$/s, "$1");

// --- Общий движок перевода: порции + ретраи + раунды добора + очистка мусора.
// Один гигантский промпт упирается в таймауты прокси/агрегаторов (502/504),
// поэтому ключи переводятся порциями (CHUNK на запрос). Каждая порция — свой
// запрос, на 5xx идут ретраи, упавшую порцию подхватит следующая модель.
// Значения с азиатскими/экзотическими письменностями (мусор от модели)
// отбрасываются и уходят в следующий раунд добора.
const CHUNK = 25;
const MAX_ATTEMPTS = 3;
const MAX_ROUNDS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BAD_SCRIPT = /[\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

const buildPrompt = (sub) => `Ты — переводчик интерфейса OpenChamber на русский язык. Переведи значения на русский. Сохрани все плейсхолдеры вида {foo} без изменений. Соблюдай терминологию: сессия (не «сеанс»), рабочее дерево (worktree), субагент, MCP-сервер, коммит, ветка, OpenCode/OpenChamber — латиницей, обращение на «вы». Верни ТОЛЬКО JSON-объект с теми же ключами и переведёнными значениями. Не добавляй код-фенсы.\n\n${JSON.stringify(sub, null, 2)}`;

/**
 * Переводит payload через модели порциями. Возвращает { json, failed }.
 * json — только чистые переводы; failed — массив ключей, которые так и не перевелись.
 */
async function translatePayload(payload) {
  const json = {};
  const covered = () => Object.keys(payload).filter((k) => json[k] && typeof json[k] === 'string' && json[k].trim());
  const uncovered = () => Object.keys(payload).filter((k) => !covered().includes(k));
  let lastFailed = null;

  for (let round = 1; round <= MAX_ROUNDS && uncovered().length > 0; round++) {
    const beforeRound = uncovered().length;

    for (const model of models) {
      const todo0 = uncovered();
      if (!todo0.length) break;
      let failed = null;
      let done = 0;
      let softBreak = false;

      for (let i = 0; i < todo0.length && !softBreak; i += CHUNK) {
        const chunkKeys = todo0.slice(i, i + CHUNK);
        const sub = {};
        for (const k of chunkKeys) sub[k] = payload[k];
        const prompt = buildPrompt(sub);
        const nPortion = Math.floor(i / CHUNK) + 1;
        const nPortions = Math.ceil(todo0.length / CHUNK);

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const res = await fetch(`${base}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model, temperature: 0.2, max_tokens: 16384, messages: [{ role: 'user', content: prompt }] }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
            const data = await res.json();
            const content = data.choices?.[0]?.message?.content || '';
            const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
            let rejected = 0;
            for (const k of chunkKeys) {
              const v = parsed[k];
              const clean = typeof v === 'string' && v.trim() ? unquotedFix(v).trim() : '';
              if (!clean) continue;
              if (BAD_SCRIPT.test(clean)) { rejected++; continue; }
              json[k] = clean;
            }
            done = todo0.length - uncovered().length;
            console.log(`  • [раунд ${round}] ${model}: порция ${nPortion}/${nPortions} — переведено ${done}/${todo0.length}${rejected ? ` (мусор: ${rejected})` : ''}`);
            break;
          } catch (e) {
            const cause = e.cause && (e.cause.code || e.cause.message || JSON.stringify(e.cause).slice(0, 300));
            failed = e.message + (cause ? ` (${cause})` : '');
            if (attempt < MAX_ATTEMPTS) {
              console.warn(`  • ${model}: порция ${nPortion}/${nPortions}, попытка ${attempt}: ${failed} — повтор через ${attempt * 3}с`);
              await sleep(attempt * 3000);
            } else {
              softBreak = true;
              console.warn(`  • ${model}: порция ${nPortion}/${nPortions} не переведена после ${MAX_ATTEMPTS} попыток: ${failed}`);
            }
          }
        }
      }

      console.log(`  • модель ${model}: переведено ${done}/${todo0.length}${failed ? ` (ошибка: ${failed})` : ''}`);
      if (done === 0 && failed) console.warn(`::warning::Модель ${model} не ответила: ${failed}`);
      lastFailed = failed;
    }

    if (uncovered().length === beforeRound) {
      console.warn(`::warning::Раунд ${round}: прогресса нет — прекращаю добор.`);
      break;
    }
  }

  return { json, failed: uncovered(), lastError: lastFailed };
}

// --- 1. Главные словари: ru.ts / ru.settings.ts.
let dict = {};
let dictFailed = [];
if (Object.keys(payload).length) {
  const r = await translatePayload(payload);
  dict = r.json;
  dictFailed = r.failed;
} else {
  const ru = load(read(ruPath));
  const rs = load(read(ruSetPath));
  console.log(`i18n-translate: пропусков нет (RU ${Object.keys(ru).length} + settings ${Object.keys(rs).length}).`);
}

// --- 2. Линейные модули (*.i18n.ts): переводим те, у которых ещё нет ru-блока
// в патчах. Апстрим регулярно добавляет новые модули (в v2.2.0 — source-board,
// environment); без ru-блока сборка падает на I18N_STRICT. Генерируем патч
// в формате остальных: комментарий + export const NameI18n = { ru: {...} }.
function hasRuBlock(file) {
  return /^[ \t]*ru: \{/m.test(read(file));
}

const linearFiles = fs.readdirSync(messagesDir)
  .filter((f) => f.endsWith('.i18n.ts'))
  .sort();
let wroteLinear = 0;

for (const f of linearFiles) {
  const patchPath = path.join(patchesDir, f);
  if (fs.existsSync(patchPath) && hasRuBlock(patchPath)) continue;

  const src = read(path.join(messagesDir, f));
  const exp = src.match(/export const (\w+) = \{/);
  if (!exp) continue;
  const enMatch = src.match(/^[ \t]*en: \{([\s\S]*?)^[ \t]*\},\n/m);
  if (!enMatch) continue;

  const pairs = load('{\n' + enMatch[1] + '\n}');
  const keys = Object.keys(pairs).filter((k) => !IGNORED.has(k));
  if (!keys.length) continue;

  console.log(`i18n-translate: линейный модуль ${f} — ${keys.length} ключей без ru-блока, перевожу…`);
  const sub = {};
  for (const k of keys) sub[k] = pairs[k];
  const r = await translatePayload(sub);
  if (r.failed.length) {
    console.error(`::error::Не переведены ключи модуля ${f}: ${r.failed.slice(0, 50).join(', ')}`);
    process.exitCode = 1;
    continue;
  }

  const lines = [];
  lines.push(`/** Русский блок для ${f} — вставляется в свежий файл апстрима. */`);
  lines.push(`export const ${exp[1]} = {`);
  lines.push(`  ru: {`);
  for (const k of keys) {
    const v = r.json[k];
    if (typeof v !== 'string' || !v.trim()) {
      console.warn(`  ! нет перевода для ${k}`);
      continue;
    }
    const clean = unquotedFix(v).trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`    '${k}': '${clean}',`);
  }
  lines.push(`  },`);
  lines.push(`};`);
  lines.push(``);
  fs.writeFileSync(patchPath, lines.join('\n'));
  wroteLinear++;
  console.log(`  ✓ создан патч ${f} (+${keys.length} ключей)`);
}

// --- 3. Запись переводов главных словарей.
let anyWrite = false;

if (Object.keys(payload).length) {
  for (const [, keys, , filePath] of groups) {
    const lines = [];
    for (const k of keys) {
      const v = dict[k];
      if (typeof v !== 'string' || !v.trim()) {
        console.warn(`  ! нет перевода для ${k}`);
        continue;
      }
      const clean = unquotedFix(v).trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      lines.push(`  '${k}': '${clean}',`);
    }
    if (!lines.length) continue;

    // Ищем строку-маркер сверху вниз, по форме, а не по точному отступу.
    // Раньше здесь стоял lastIndexOf по жёсткой строке '\n  ...linearIntegrationI18n.ru,'
    // с двумя пробелами; после того как форматтер переставил спред с 2 отступов на 4,
    // маркер перестал совпадать и перевод падал с «маркер не найден» уже ПОСЛЕ
    // успешного обращения к модели — то есть работа модели уходила в никуда.
    const fileLines = read(filePath).split('\n');
    const isSettings = filePath.endsWith('ru.settings.ts');
    const markerRe = isSettings
      ? /^\s*\.\.\.linearIntegrationI18n\.ru,\s*$/
      : /^\s*\};?\s*$/;

    let at = -1;
    for (let i = fileLines.length - 1; i >= 0; i--) {
      if (markerRe.test(fileLines[i])) { at = i; break; }
    }
    if (at < 0) {
      throw new Error(
        `маркер не найден в ${path.basename(filePath)} — вставка невозможна. ` +
        'Обновите i18n-translate.mjs под текущую структуру файла.'
      );
    }

    fileLines.splice(at, 0, ...lines);
    fs.writeFileSync(filePath, fileLines.join('\n'));
    anyWrite = true;
    console.log(`  ✓ обновлён ${path.basename(filePath)} (+${lines.length} ключей)`);
  }
}

if (dictFailed.length) {
  console.error(`::error::Ни одна из моделей (${models.join(', ')}) не перевела: ${dictFailed.slice(0, 50).join(', ')}`);
  process.exitCode = 1;
}

const doneSomething = Object.keys(payload).length > 0 || wroteLinear > 0;
console.log(doneSomething ? 'i18n-translate: готово.' : 'i18n-translate: добавить нечего.');
process.exit(process.exitCode || 0);