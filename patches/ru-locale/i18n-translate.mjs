#!/usr/bin/env node
// Авто-перевод недостающих ключей RU-локали через OpenAI-совместимый API.
//
//   node i18n-translate.mjs <messages_dir> <patches_dir> [--strict]
//
// <messages_dir> — каталог словарей апстрима (packages/ui/src/lib/i18n/messages).
// <patches_dir>  — каталог patches/ru-locale (ru.ts, ru.settings.ts, *.i18n.ts).
//
// Главный принцип: перевод НИКОГДА не блокирует сборку. Если модель не смогла
// перевести ключ, в словарь кладётся английский оригинал (чтобы strict-проверка
// и tsc видели ключ), а сам ключ попадает в pending.json. На следующем прогоне
// он будет переведён снова. --strict оставлен для ручной диагностики.
//
// Окружение (всё через Секреты репозитория):
//   TRANSLATE_API_KEY   — Bearer-токен (или токен OpenAI-совместимого провайдера)
//   TRANSLATE_API_USER  — логин для Basic-авторизации (вместе с PASS)
//   TRANSLATE_API_PASS  — пароль для Basic-авторизации
//   TRANSLATE_API_BASE  — URL эндпоинта, например https://api.openai.com/v1
//                         или http://IP:ПОРТ/v1 (Ollama/локальный сервер)
//   TRANSLATE_MODEL              — основная модель, по умолчанию gpt-4o-mini
//   TRANSLATE_FALLBACK_MODEL     — резервная модель
//   TRANSLATE_RESERVE_MODEL      — запасная модель
//   TRANSLATE_MODELS             — список моделей через запятую (приоритетнее)
//   TRANSLATE_POOL               — то же самое, старый формат (список через запятую)
//   TRANSLATE_MAX_MODELS         — сколько моделей из /models брать (по умолчанию 200)
//   TRANSLATE_CHUNK              — стартовый размер порции (по умолчанию 8)
//   TRANSLATE_MAX_CHUNK          — максимальный размер порции (по умолчанию 16)
//   TRANSLATE_MAX_MODEL_TRIES    — сколько моделей пробовать на один запрос (15)
//   TRANSLATE_TIME_BUDGET_MS     — общий бюджет перевода (30 минут)
//   TRANSLATE_REQUEST_TIMEOUT_MS — таймаут одного запроса (120 секунд)
//
// Выход: 0 — работа завершена (даже если часть ключей осталась английской),
//        1 — только при --strict и наличии непереведённых ключей.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const positional = argv.filter((a) => !a.startsWith('--'));
const messagesDir = positional[0];
const patchesDir = positional[1];
if (!messagesDir || !patchesDir) {
  console.error('usage: node i18n-translate.mjs <messages_dir> <patches_dir> [--strict]');
  process.exit(2);
}

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
const exists = (p) => fs.existsSync(p);

const IGNORED = new Set(['onboarding.localSetup.windows.stepInstallWslSuffix']);
const MOCK_RE = /^Перевод\(мок:/i;
// Мусорные письменности: кириллица/латиница — норма, остальное почти всегда
// означает, что модель «съехала» на другой язык или вернула обрывок.
const BAD_SCRIPT = /[\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const CHUNK = num('TRANSLATE_CHUNK', 8);
const MAX_CHUNK = Math.max(CHUNK, num('TRANSLATE_MAX_CHUNK', 16));
const MAX_MODEL_TRIES = num('TRANSLATE_MAX_MODEL_TRIES', 15);
const MAX_ROUNDS = num('TRANSLATE_ROUNDS', 3);
const REQUEST_TIMEOUT = num('TRANSLATE_REQUEST_TIMEOUT_MS', 120_000);
const TIME_BUDGET = num('TRANSLATE_TIME_BUDGET_MS', 30 * 60_000);
const DEADLINE = Date.now() + TIME_BUDGET;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const budgetLeft = () => DEADLINE - Date.now();
const budgetExceeded = () => budgetLeft() <= 0;

// ============================================================
// Разбор исходников. Апстрим мешает формы: ключи в одинарных и двойных
// кавычках, объекты в одну строку (ui-blocks), значения с апострофами и
// переводами строк. Поэтому не regex по строкам, а настоящий сканер
// строк/скобок. Он не исполняет код и не зависит от форматирования.
// ============================================================

/** Пропускает пробелы, переводы строк и комментарии. */
function skipTrivia(text, i) {
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    break;
  }
  return i;
}

/** Читает строковый литерал, начиная с кавычки. Возвращает { value, end }. */
function readStringLiteral(text, i) {
  const quote = text[i];
  const start = i;
  i++;
  let out = '';
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\\') {
      const next = text[i + 1];
      if (next === undefined) { i++; break; }
      switch (next) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case 'u': {
          const hex = text.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue; }
          out += 'u';
          break;
        }
        case 'x': {
          const hex = text.slice(i + 2, i + 4);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; continue; }
          out += 'x';
          break;
        }
        default: out += next;
      }
      i += 2;
      continue;
    }
    if (c === quote) {
      i++;
      return { value: out, end: i, raw: text.slice(start, i) };
    }
    if (c === '\n' && quote !== '`') {
      // Одинарные/двойные строки не могут содержать неэкранированный перевод
      // строки. Не падаем: считаем, что литерал закончился здесь.
      return { value: out, end: i, raw: text.slice(start, i) };
    }
    out += c;
    i++;
  }
  return { value: out, end: i, raw: text.slice(start, i) };
}

/** Индекс закрывающей скобки для { или [ с учётом строк и комментариев. */
function findMatching(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let i = openIdx;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = readStringLiteral(text, i).end;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Ищет блок локали вида `en: { ... }` (ключ может быть в кавычках).
 * Возвращает позиции ключа, открывающей и закрывающей скобок.
 */
function findLocaleBlock(text, code) {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^([ \\t]*)['"]?${escaped}['"]?\\s*:\\s*\\{`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const keyStart = m.index;
  const open = m.index + m[0].lastIndexOf('{');
  const close = findMatching(text, open);
  if (close < 0) return null;
  return { keyStart, indent: m[1], open, close, inner: text.slice(open + 1, close) };
}

/**
 * Разбирает плоский объект локали. Возвращает Map key -> { type, value, raw }.
 * Поддерживает однострочные объекты, запятые, комментарии, вложенные объекты
 * (они помечаются type: 'object' и не переводятся).
 */
function parseFlatObject(inner) {
  const out = new Map();
  const n = inner.length;
  let i = 0;
  while (i < n) {
    i = skipTrivia(inner, i);
    if (i >= n) break;
    if (inner[i] === ',') { i++; continue; }
    if (inner[i] === '.' && inner[i + 1] === '.' && inner[i + 2] === '.') {
      // Спред в блоке локали — не ключ. Пропускаем до запятой верхнего уровня.
      i += 3;
      let depth = 0;
      while (i < n) {
        const c = inner[i];
        if (c === '"' || c === "'" || c === '`') { i = readStringLiteral(inner, i).end; continue; }
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
        else if (c === ',' && depth === 0) break;
        i++;
      }
      continue;
    }

    let key = '';
    if (inner[i] === '"' || inner[i] === "'" || inner[i] === '`') {
      const lit = readStringLiteral(inner, i);
      key = lit.value;
      i = lit.end;
    } else {
      const start = i;
      while (i < n && /[A-Za-z0-9_$.-]/.test(inner[i])) i++;
      key = inner.slice(start, i);
      if (!key) { i++; continue; }
    }

    i = skipTrivia(inner, i);
    if (inner[i] !== ':') {
      // Сокращённая запись { foo } — в блоках локалей не встречается, но
      // не должны зациклиться.
      while (i < n && inner[i] !== ',' && inner[i] !== '}') i++;
      continue;
    }
    i++;
    i = skipTrivia(inner, i);

    if (inner[i] === '"' || inner[i] === "'" || inner[i] === '`') {
      const lit = readStringLiteral(inner, i);
      out.set(key, { type: 'string', value: lit.value, raw: lit.raw });
      i = lit.end;
    } else if (inner[i] === '{') {
      const close = findMatching(inner, i);
      if (close < 0) break;
      out.set(key, { type: 'object', raw: inner.slice(i, close + 1) });
      i = close + 1;
    } else if (inner[i] === '[') {
      const close = findMatching(inner, i);
      if (close < 0) break;
      out.set(key, { type: 'array', raw: inner.slice(i, close + 1) });
      i = close + 1;
    } else {
      const start = i;
      let depth = 0;
      while (i < n) {
        const c = inner[i];
        if (c === '"' || c === "'" || c === '`') { i = readStringLiteral(inner, i).end; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) break;
          depth--;
        } else if (c === ',' && depth === 0) break;
        i++;
      }
      out.set(key, { type: 'other', raw: inner.slice(start, i).trim() });
    }
  }
  return out;
}

/** Экранирует значение для TS-строки в одинарных кавычках. */
function tsString(value, quote = "'") {
  let s = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (quote === "'") s = s.replace(/'/g, "\\'");
  else s = s.replace(/"/g, '\\"');
  return quote + s + quote;
}

/** Строковые ключи словаря (ru.ts / ru.settings.ts) — по одной записи на строку. */
function parseDict(text) {
  const out = new Map();
  const re = /^[\t ]*(['"])([-\w.]+)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\n])*)\3\s*,?[\t ]*$/gm;
  let m;
  while ((m = re.exec(text))) {
    out.set(m[2], decodeQuotedBody(m[4], m[3]));
  }
  return out;
}

/** Индекс строки словаря для ключа (нужен при точечной замене значения). */
function dictLineIndex(lines, key) {
  const re = new RegExp(`^[\\t ]*(['"])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

function decodeQuotedBody(body, quote) {
  // Тело уже без кавычек. Разэкранируем только то, что важно для сравнения.
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const next = body[i + 1];
    if (next === undefined) break;
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case '\\': out += '\\'; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case '`': out += '`'; break;
      case 'u': {
        const hex = body.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; continue; }
        out += 'u';
        break;
      }
      default: out += next;
    }
    i++;
  }
  return quote === '"' ? out : out;
}

// ============================================================
// Модели: явный список + автопоиск через /models. Старый TRANSLATE_POOL
// отправлял массив `models` в одном запросе; многие шлюзы этого не понимают
// и отвечают 504. Здесь каждая модель — отдельный запрос, а пул используется
// как очередь перебора.
// ============================================================

const apiKey = process.env.TRANSLATE_API_KEY;
const apiUser = process.env.TRANSLATE_API_USER;
const apiPass = process.env.TRANSLATE_API_PASS;
const base = (process.env.TRANSLATE_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const hasAuth = Boolean(apiKey || apiPass);

const headers = { 'Content-Type': 'application/json' };
if (apiPass) headers.Authorization = 'Basic ' + Buffer.from(`${apiUser || ''}:${apiPass}`).toString('base64');
else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

const splitList = (s) => String(s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

const configuredModels = [...new Set([
  ...splitList(process.env.TRANSLATE_MODELS),
  ...splitList(process.env.TRANSLATE_MODEL),
  ...splitList(process.env.TRANSLATE_FALLBACK_MODEL),
  ...splitList(process.env.TRANSLATE_RESERVE_MODEL),
  ...splitList(process.env.TRANSLATE_POOL),
])];
if (!configuredModels.length) configuredModels.push('gpt-4o-mini');

const SKIP_MODEL_RE = /(embed|embedding|whisper|tts|speech|transcrib|moderation|rerank|dall-?e|stable-diffusion|sdxl|flux|image-gen|audio)/i;

async function discoverModels() {
  if (!hasAuth) return [];
  try {
    const res = await fetch(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT, 30_000)),
    });
    if (!res.ok) {
      console.warn(`::warning::/models вернул HTTP ${res.status} — работаю со списком из секретов`);
      return [];
    }
    const data = await res.json();
    const ids = Array.isArray(data?.data)
      ? data.data.map((m) => m && m.id).filter((id) => typeof id === 'string' && id)
      : [];
    return ids.filter((id) => !SKIP_MODEL_RE.test(id));
  } catch (e) {
    console.warn(`::warning::/models недоступен (${e.message}) — работаю со списком из секретов`);
    return [];
  }
}

const discoveredModels = await discoverModels();
const maxModels = num('TRANSLATE_MAX_MODELS', 200);
const allModels = [...new Set([...configuredModels, ...discoveredModels])].slice(0, maxModels);
console.log(`i18n-translate: моделей доступно ${allModels.length} (явных ${configuredModels.length}, из /models ${discoveredModels.length})`);

const health = new Map(); // model -> { fails, cooldownUntil, lastError }
let preferredModel = null;
let rotation = 0;

function modelState(id) {
  if (!health.has(id)) health.set(id, { fails: 0, cooldownUntil: 0, lastError: null });
  return health.get(id);
}

function markModelOk(id) {
  const h = modelState(id);
  h.fails = 0;
  h.cooldownUntil = 0;
  h.lastError = null;
  preferredModel = id;
}

function markModelFail(id, message, status) {
  const h = modelState(id);
  h.fails++;
  h.lastError = message;
  const cooldown = status === 429 ? 60_000 : status >= 500 ? 120_000 : 20_000;
  h.cooldownUntil = Date.now() + cooldown;
}

/**
 * Порядок перебора: сначала модель, которая уже отвечала, затем остальные с
 * ротацией. Ротация важна, когда шлюз валит часть моделей: каждый следующий
 * запрос начинается с другой, и все 150 моделей получают шанс.
 */
function modelOrder() {
  const now = Date.now();
  const ready = allModels.filter((m) => modelState(m).cooldownUntil <= now);
  const cooling = allModels.filter((m) => !ready.includes(m));
  const head = [];
  if (preferredModel && ready.includes(preferredModel)) head.push(preferredModel);
  const rest = ready.filter((m) => !head.includes(m));
  if (rest.length) {
    const off = rotation++ % rest.length;
    head.push(...rest.slice(off), ...rest.slice(0, off));
  }
  return [...head, ...cooling];
}

// ============================================================
// Запрос к модели и разбор ответа.
// ============================================================

const SYSTEM_PROMPT = `Ты — профессиональный переводчик интерфейса OpenChamber на русский язык.
Переведи значения на русский. Сохрани без изменений все плейсхолдеры: {foo}, {count, plural, ...}, %s, %d, $1, <tag>.
Терминология: сессия (не «сеанс»), рабочее дерево (worktree), субагент, MCP-сервер, коммит, ветка, OpenCode/OpenChamber — латиницей, обращение на «вы».
Не переводи ключи. Не добавляй пояснений и markdown. Верни ТОЛЬКО JSON-объект с теми же ключами и переведёнными значениями.`;

function userPrompt(sub) {
  return `Переведи строки. Верни строго JSON-объект (ключ → перевод), без код-фенсов и комментариев:\n${JSON.stringify(sub, null, 2)}`;
}

function estimateTokens(sub) {
  const chars = Object.values(sub).reduce((n, v) => n + String(v).length, 0);
  return Math.min(8192, Math.max(512, Math.ceil(chars * 1.6) + 256));
}

function extractContent(data) {
  const choice = data?.choices?.[0];
  if (!choice) return '';
  const msg = choice.message;
  let content = msg?.content;
  if (Array.isArray(content)) content = content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  if ((!content || !String(content).trim()) && typeof msg?.reasoning_content === 'string') content = msg.reasoning_content;
  if ((!content || !String(content).trim()) && typeof choice.text === 'string') content = choice.text;
  return typeof content === 'string' ? content : '';
}

/** Достаёт переводы даже из обрезанного JSON. */
function parseTranslations(content, requestedKeys) {
  const wanted = new Set(requestedKeys);
  const found = new Map();
  const accepted = (key, value) => {
    if (!wanted.has(key) || typeof value !== 'string') return;
    const clean = value.trim();
    if (!clean || MOCK_RE.test(clean) || BAD_SCRIPT.test(clean)) return;
    found.set(key, clean);
  };

  let text = String(content || '').replace(/^\uFEFF/, '').trim();
  text = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  const first = text.indexOf('{');
  if (first >= 0) {
    const last = text.lastIndexOf('}');
    if (last > first) {
      try {
        const obj = JSON.parse(text.slice(first, last + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          for (const [k, v] of Object.entries(obj)) accepted(k, v);
        }
      } catch { /* ниже попробуем починить */ }
    }
    if (!found.size) {
      const repaired = repairTruncatedJson(text.slice(first));
      if (repaired) {
        try {
          const obj = JSON.parse(repaired);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            for (const [k, v] of Object.entries(obj)) accepted(k, v);
          }
        } catch { /* ниже regex-добор */ }
      }
    }
  }

  // Последний шанс: вытащить завершённые пары из обрезанного ответа.
  // Двойные кавычки — обычный JSON, одинарные — «почти JSON» некоторых моделей.
  if (found.size < wanted.size) {
    for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      try { accepted(JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`)); } catch { /* пропуск */ }
    }
    for (const m of text.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
      const decode = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      accepted(decode(m[1]), decode(m[2]));
    }
  }

  return found;
}

/**
 * Чинит обрезанный JSON: отрезает незавершённую пару по последней запятой
 * верхнего уровня и закрывает объект. Полные пары при этом сохраняются.
 */
function repairTruncatedJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  text = text.slice(start);
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;
  let lastComma = -1;
  let lastCompletePair = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
      if (depth === 1) lastCompletePair = i;
    } else if (c === ',' && depth === 1) {
      lastComma = i;
    }
  }
  // Обрезано. Берём всё до последней запятой верхнего уровня (последняя
  // полностью закрытая пара) и закрываем объект.
  if (lastComma > 0) {
    let cut = lastComma;
    // Если после запятой успела начаться следующая пара, она уже отрезана.
    return text.slice(0, cut).replace(/,\s*$/, '') + '}';
  }
  if (lastCompletePair > 0) return text.slice(0, lastCompletePair + 1) + '}';
  return null;
}

/** Проверяет, что простые плейсхолдеры не потерялись. */
function placeholdersOk(source, translated) {
  const src = String(source);
  const dst = String(translated);
  const simple = [...src.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((m) => `{${m[1]}}`);
  for (const token of simple) {
    if (!dst.replace(/\s+/g, '').includes(token.replace(/\s+/g, ''))) return false;
  }
  // ICU-переменные: {count, plural, ...} — достаточно проверить имя и запятую,
  // потому что внутренний текст переводится и меняется.
  for (const m of src.matchAll(/\{([A-Za-z0-9_.-]+)\s*,/g)) {
    const re = new RegExp(`\\{\\s*${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`);
    if (!re.test(dst)) return false;
  }
  for (const token of src.match(/%[sdif@]/g) || []) {
    if (!dst.includes(token)) return false;
  }
  for (const token of src.match(/\$\d+/g) || []) {
    if (!dst.includes(token)) return false;
  }
  return true;
}

async function callModel(model, sub) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(sub) },
  ];
  const baseBody = { model, messages, temperature: 0.1, max_tokens: estimateTokens(sub) };
  const url = `${base}/chat/completions`;

  const attempt = async (body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const raw = await res.text();
    if (!res.ok) {
      let extra = raw.slice(0, 500);
      try { extra = JSON.stringify(JSON.parse(raw)?.error || JSON.parse(raw)).slice(0, 500); } catch { /* как есть */ }
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${extra}` };
    }
    let data;
    try { data = JSON.parse(raw); } catch { return { ok: false, status: res.status, error: `не JSON: ${raw.slice(0, 200)}` }; }
    return { ok: true, status: res.status, content: extractContent(data), data };
  };

  let r;
  try {
    r = await attempt(baseBody);
  } catch (e) {
    return { ok: false, status: 0, error: e.cause ? `${e.message} (${e.cause.code || e.cause.message || ''})` : e.message };
  }

  // Некоторые модели/шлюзы не принимают temperature или max_tokens.
  // Повторяем минимальным телом — это дешевле, чем терять модель.
  if (!r.ok && r.status === 400 && /temperature|max_tokens|max_completion_tokens|unsupported|unknown/i.test(r.error)) {
    try {
      r = await attempt({ model, messages });
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  }
  return r;
}

/**
 * Переводит одну порцию. Перебирает модели, пока какая-нибудь не ответит
 * валидным JSON. Возвращает { translations, ok, hardFail }.
 */
async function requestWithModels(sub) {
  const keys = Object.keys(sub);
  let consecutiveFails = 0;
  let lastError = null;

  for (const model of modelOrder()) {
    if (budgetExceeded()) break;
    if (consecutiveFails >= MAX_MODEL_TRIES) break;

    const r = await callModel(model, sub);
    if (!r.ok) {
      lastError = r.error;
      const status = r.status;
      markModelFail(model, r.error, status);
      consecutiveFails++;
      // Каждая модель получает один шанс за проход. Логируем только первую
      // ошибку каждого типа, чтобы не залить лог сотней одинаковых строк.
      if (consecutiveFails <= 3) console.warn(`  · ${model}: ${r.error}`);
      continue;
    }

    const translations = parseTranslations(r.content, keys);
    if (translations.size) {
      markModelOk(model);
      return { ok: true, translations, model };
    }

    // Ответ 200, но JSON не разобрался либо значения не прошли проверку.
    // Считаем это сбоем модели и идём дальше: следующая часто отвечает лучше.
    lastError = 'ответ без валидного JSON';
    markModelFail(model, lastError, 200);
    consecutiveFails++;
    if (consecutiveFails <= 3) console.warn(`  · ${model}: ${lastError} (фрагмент: ${String(r.content).slice(0, 120).replace(/\n/g, ' ')})`);
  }

  return { ok: false, translations: new Map(), hardFail: true, lastError };
}

/**
 * Рекурсивно переводит порцию: если модель вернула только часть ключей,
 * делим остаток пополам и пробуем снова. Так одна «тяжёлая» строка не
 * блокирует весь модуль, а одиночный ключ в конце переводится отдельным
 * крошечным запросом.
 */
async function translateChunk(label, sub, depth = 0) {
  const keys = Object.keys(sub);
  if (!keys.length || budgetExceeded()) return new Map();

  const r = await requestWithModels(sub);
  if (!r.ok) return r.translations; // тотальный сбой API — деление не поможет

  if (r.translations.size === keys.length || keys.length === 1) return r.translations;

  const missing = keys.filter((k) => !r.translations.has(k));
  const mid = Math.ceil(missing.length / 2);
  const parts = [missing.slice(0, mid), missing.slice(mid)].filter((p) => p.length);
  const out = new Map(r.translations);
  for (const part of parts) {
    if (budgetExceeded()) break;
    const sub2 = {};
    for (const k of part) sub2[k] = sub[k];
    const got = await translateChunk(label, sub2, depth + 1);
    for (const [k, v] of got) out.set(k, v);
  }
  return out;
}

/**
 * Переводит набор ключей раундами. Внутри раунда — порции; между раундами
 * пауза, чтобы квотные шлюзы успели «отпустить» каналы.
 */
async function translateKeys(label, entries, forceKeys) {
  const todo = new Map();
  for (const k of forceKeys) {
    if (entries.has(k)) todo.set(k, entries.get(k));
  }
  const translations = new Map();
  let remaining = [...todo.keys()];
  let chunk = CHUNK;

  for (let round = 1; round <= MAX_ROUNDS && remaining.length; round++) {
    const next = [];
    let portion = 0;
    for (let i = 0; i < remaining.length;) {
      if (budgetExceeded()) { next.push(...remaining.slice(i)); break; }
      // Размер порции фиксируем на итерацию: если менять `chunk` в теле
      // цикла, шаг `i += chunk` начнёт прыгать через ключи.
      const size = chunk;
      const keys = remaining.slice(i, i + size);
      const sub = {};
      for (const k of keys) sub[k] = todo.get(k);
      const got = await translateChunk(label, sub);
      for (const [k, v] of got) translations.set(k, v);
      const still = keys.filter((k) => !translations.has(k));
      next.push(...still);

      if (still.length === keys.length) chunk = Math.max(1, Math.floor(size / 2));
      else if (!still.length && size < MAX_CHUNK) chunk = Math.min(MAX_CHUNK, size + 1);

      portion++;
      i += size;
      console.log(`  • ${label}: раунд ${round}, порция ${portion}, переведено ${got.size}/${keys.length}, осталось ${next.length}`);
    }
    remaining = [...new Set(next)];
    if (remaining.length && round < MAX_ROUNDS) {
      const pause = Math.min(60_000, round * 15_000);
      console.log(`  • ${label}: ${remaining.length} ключей в доборе, пауза ${Math.round(pause / 1000)}с`);
      await sleep(pause);
    }
  }

  return { translations, remaining };
}

// ============================================================
// Pending: английские заглушки, которые нужно перевести в следующий раз.
// ============================================================

const pendingPath = path.join(patchesDir, 'pending.json');
function loadPending() {
  if (!exists(pendingPath)) return {};
  try {
    const data = JSON.parse(read(pendingPath));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    console.warn('::warning::pending.json повреждён — начинаю с чистого листа');
    return {};
  }
}

const pending = loadPending();

/**
 * Ключи, которые надо перевести принудительно: их RU-значение отсутствует,
 * совпадает с английским (наша заглушка) или является мок-переводом.
 */
function keysToForce(enEntries, ruEntries, pendingForTarget) {
  const out = new Set();
  for (const [key, en] of enEntries) {
    if (IGNORED.has(key)) continue;
    const ru = ruEntries.get(key);
    const ruText = ru && typeof ru === 'object' ? ru.value : ru;
    const inPending = Object.prototype.hasOwnProperty.call(pendingForTarget || {}, key);

    // Ключа нет, он пустой или это мок-строка — переводим всегда.
    if (ruText === undefined || ruText === null || ruText === '' || MOCK_RE.test(String(ruText))) {
      out.add(key);
      continue;
    }

    // Английский текст в pending — заглушка прошлого прогона, которую надо
    // добрать. Вне pending совпадение с английским считаем осмысленным
    // переводом («API», «MCP»): иначе такие ключи переводились бы вечно.
    if (inPending && ruText === en) {
      out.add(key);
      continue;
    }

    // Если в pending лежит ключ, но в словаре уже стоит осмысленный
    // (не английский) перевод — считаем, что человек поправил его вручную.
  }
  return out;
}

function savePending(nextEntries) {
  const data = {};
  for (const [target, entries] of Object.entries(nextEntries)) {
    if (entries && Object.keys(entries).length) data[target] = entries;
  }
  write(pendingPath, JSON.stringify(data, null, 2) + '\n');
  const total = Object.values(data).reduce((n, e) => n + Object.keys(e).length, 0);
  if (total) console.log(`i18n-translate: в pending.json ${total} ключей (английские заглушки, переведём в следующий раз)`);
  else console.log('i18n-translate: pending.json пуст');
}

// ============================================================
// Применение переводов.
// ============================================================

const nextPending = {};

/** Обновляет/дописывает ключи в ru.ts / ru.settings.ts. */
function applyDict(filePath, target, enEntries, force, translations) {
  const before = read(filePath);
  const lines = before.split('\n');
  const current = parseDict(before);
  const added = [];
  const updated = [];

  // 1. Заменяем значения уже существующих ключей (pending-добор).
  for (const [key, value] of translations) {
    if (!current.has(key)) continue;
    const lineIdx = dictLineIndex(lines, key);
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    const line = lines[lineIdx];
    const keyQuote = line.trimStart().startsWith('"') ? '"' : "'";
    const indent = (line.match(/^\s*/) || [''])[0];
    lines[lineIdx] = `${indent}${keyQuote}${key}${keyQuote}: ${tsString(value)}${line.trimEnd().endsWith(',') ? ',' : ''}`;
    updated.push(key);
  }

  // 2. Новые ключи — перед закрывающей скобкой словаря.
  const pendingTarget = {};
  for (const key of enEntries.keys()) {
    if (IGNORED.has(key) || current.has(key)) continue;
    let value = translations.get(key);
    if (!value) {
      value = enEntries.get(key); // английская заглушка
      pendingTarget[key] = enEntries.get(key);
    }
    added.push(`  '${key}': ${tsString(value)},`);
  }
  if (Object.keys(pendingTarget).length) nextPending[target] = pendingTarget;

  if (!added.length && !updated.length) {
    console.log(`  → ${path.basename(filePath)}: новых ключей нет`);
    return;
  }

  let closeAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[ \t]*\}(?: as const)?;[ \t]*$/.test(lines[i])) { closeAt = i; break; }
  }
  if (closeAt < 0) {
    console.error(`::warning::${path.basename(filePath)}: не нашёл закрывающую скобку — ключи не записаны`);
    process.exitCode = strict ? 1 : process.exitCode || 0;
    return;
  }
  if (added.length) lines.splice(closeAt, 0, ...added);
  write(filePath, lines.join('\n'));
  console.log(`  ✓ ${path.basename(filePath)}: +${added.length} новых, ~${updated.length} обновлено`);
}

/** Собирает текст ru-блока для патча модуля. */
function renderRuBlock(entries) {
  const lines = ['  ru: {'];
  for (const [key, value] of entries) {
    lines.push(`    '${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}': ${tsString(value)},`);
  }
  lines.push('  },');
  return lines.join('\n');
}

/** Записывает ru-блок в патч модуля, не трогая остальные локали. */
function applyModulePatch(fileName, upstreamText, patchPath, enEntries, force, translations) {
  const exportMatch = upstreamText.match(/export const (\w+) = \{/);
  const exportName = exportMatch ? exportMatch[1] : fileName.replace(/\.i18n\.ts$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'I18n';

  let patchText = exists(patchPath) ? read(patchPath) : '';
  const existingRu = patchText ? findLocaleBlock(patchText, 'ru') : null;
  const existing = existingRu ? parseFlatObject(existingRu.inner) : new Map();

  const merged = new Map();
  for (const [key, entry] of existing) {
    if (entry.type !== 'string') continue;
    // Мок-перевод устаревшего ключа (его больше нет в английском словаре)
    // выкидываем совсем: в патчах не должно оставаться мок-строк.
    if (MOCK_RE.test(entry.value) && !enEntries.has(key)) continue;
    merged.set(key, entry.value);
  }

  const pendingTarget = {};
  const translatedKeys = new Set();
  for (const [key, value] of translations) {
    merged.set(key, value);
    translatedKeys.add(key);
  }
  for (const [key, enValue] of enEntries) {
    if (IGNORED.has(key)) continue;
    if (translatedKeys.has(key)) continue;
    // Если в патче уже есть осмысленный перевод — не перетираем его.
    const cur = merged.get(key);
    if (cur !== undefined && cur !== enValue && !MOCK_RE.test(String(cur))) continue;
    if (force.has(key)) {
      merged.set(key, enValue); // заглушка на случай, если модель не справилась
      pendingTarget[key] = enValue;
    } else if (cur === undefined) {
      merged.set(key, enValue);
      pendingTarget[key] = enValue;
    }
  }
  if (Object.keys(pendingTarget).length) {
    nextPending[`module:${fileName.replace(/\.i18n\.ts$/, '')}`] = pendingTarget;
  }

  const block = renderRuBlock(merged);

  if (!patchText) {
    patchText = `/** Русский блок для ${fileName} — вставляется в свежий файл апстрима. */\n` +
      `export const ${exportName} = {\n${block}\n};\n`;
  } else if (existingRu) {
    const start = existingRu.keyStart;
    const end = existingRu.close + 1;
    // Захватываем строку целиком, чтобы не оставить «хвост» старого блока.
    const lineStart = patchText.lastIndexOf('\n', start) + 1;
    let lineEnd = patchText.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = patchText.length;
    else lineEnd += 1;
    const indent = existingRu.indent;
    patchText = patchText.slice(0, lineStart) + indent + block.replace(/^  /, '') + (patchText[lineEnd - 1] === '\n' ? '\n' : '') + patchText.slice(lineEnd);
  } else {
    // В патче нет ru-блока: вставляем после en-блока (или перед } as const).
    const enBlock = findLocaleBlock(patchText, 'en');
    const lineEnd = enBlock ? patchText.indexOf('\n', enBlock.close) + 1 : -1;
    if (lineEnd > 0) patchText = patchText.slice(0, lineEnd) + block + '\n' + patchText.slice(lineEnd);
    else {
      const close = patchText.lastIndexOf('}');
      if (close < 0) patchText += `\n${block}\n`;
      else patchText = patchText.slice(0, close) + block + '\n' + patchText.slice(close);
    }
  }

  write(patchPath, patchText);
  console.log(`  ✓ ${fileName}: ru-блок ${existingRu ? 'обновлён' : 'создан'} (${merged.size} ключей${Object.keys(pendingTarget).length ? `, ${Object.keys(pendingTarget).length} заглушек` : ''})`);
}

// ============================================================
// 1. Главные словари: ru.ts / ru.settings.ts.
// ============================================================

const enMainPath = path.join(messagesDir, 'en.ts');
const enSetPath = path.join(messagesDir, 'en.settings.ts');
const ruPath = path.join(patchesDir, 'ru.ts');
const ruSetPath = path.join(patchesDir, 'ru.settings.ts');

const enMain = parseDict(read(enMainPath));
const enSet = parseDict(read(enSetPath));
const ruMain = parseDict(read(ruPath));
const ruSet = parseDict(read(ruSetPath));

const pendingMain = pending.main || {};
const pendingSet = pending.settings || {};
const forceMain = keysToForce(enMain, ruMain, pendingMain);
const forceSet = keysToForce(enSet, ruSet, pendingSet);

console.log(`i18n-translate: main — EN ${enMain.size}, RU ${ruMain.size}, к переводу ${forceMain.size}`);
console.log(`i18n-translate: settings — EN ${enSet.size}, RU ${ruSet.size}, к переводу ${forceSet.size}`);

async function processDict(label, enEntries, ruEntries, force, filePath, target, pendingForTarget) {
  if (!force.size) {
    // pending мог остаться с прошлого раза; чистим только те записи, которые
    // уже переведены или исчезли из английского словаря.
    const left = {};
    for (const [key, enValue] of Object.entries(pendingForTarget || {})) {
      if (!enEntries.has(key)) continue;
      const cur = ruEntries.get(key);
      if (!cur || cur === enValue) left[key] = enValue;
    }
    if (Object.keys(left).length) nextPending[target] = left;
    return;
  }
  const { translations, remaining } = await translateKeys(label, enEntries, force);
  applyDict(filePath, target, enEntries, force, translations);
  if (remaining.length) {
    const left = {};
    for (const key of remaining) left[key] = enEntries.get(key);
    nextPending[target] = { ...(nextPending[target] || {}), ...left };
  }
}

await processDict('main', enMain, ruMain, forceMain, ruPath, 'main', pendingMain);
await processDict('settings', enSet, ruSet, forceSet, ruSetPath, 'settings', pendingSet);

// ============================================================
// 2. Линейные модули (*.i18n.ts): новые модули + добор ключей.
// ============================================================

const linearFiles = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.i18n.ts')).sort();
console.log(`i18n-translate: линейных модулей ${linearFiles.length}`);

for (const fileName of linearFiles) {
  const upstreamPath = path.join(messagesDir, fileName);
  const upstreamText = read(upstreamPath);
  const enBlock = findLocaleBlock(upstreamText, 'en');
  if (!enBlock) {
    console.warn(`  → ${fileName}: нет en-блока, пропуск`);
    continue;
  }
  const enEntries = new Map();
  for (const [key, entry] of parseFlatObject(enBlock.inner)) {
    if (entry.type === 'string' && !IGNORED.has(key)) enEntries.set(key, entry.value);
  }
  if (!enEntries.size) continue;

  const patchPath = path.join(patchesDir, fileName);
  const patchText = exists(patchPath) ? read(patchPath) : '';
  const ruBlock = patchText ? findLocaleBlock(patchText, 'ru') : null;
  const ruEntries = new Map();
  if (ruBlock) {
    for (const [key, entry] of parseFlatObject(ruBlock.inner)) {
      if (entry.type === 'string') ruEntries.set(key, { value: entry.value });
    }
  }
  const moduleKey = fileName.replace(/\.i18n\.ts$/, '');
  const pendingForTarget = pending[`module:${moduleKey}`] || {};
  const force = keysToForce(enEntries, ruEntries, pendingForTarget);

  if (!force.size) {
    const left = {};
    for (const [key, enValue] of Object.entries(pendingForTarget)) {
      if (!enEntries.has(key)) continue;
      const cur = ruEntries.get(key);
      if (!cur || cur.value === enValue) left[key] = enValue;
    }
    if (Object.keys(left).length) nextPending[`module:${moduleKey}`] = left;
    continue;
  }

  console.log(`  → ${fileName}: к переводу ${force.size} из ${enEntries.size}`);
  const { translations } = await translateKeys(fileName, enEntries, force);
  applyModulePatch(fileName, upstreamText, patchPath, enEntries, force, translations);

  const missing = [...force].filter((k) => !translations.has(k));
  if (missing.length) {
    const left = { ...(nextPending[`module:${moduleKey}`] || {}) };
    for (const key of missing) left[key] = enEntries.get(key);
    nextPending[`module:${moduleKey}`] = left;
  }
}

savePending(nextPending);

// ============================================================
// Итог.
// ============================================================

const pendingTotal = Object.values(nextPending).reduce((n, e) => n + Object.keys(e).length, 0);
if (pendingTotal) {
  const msg = `i18n-translate: ${pendingTotal} ключей оставлены английскими заглушками — они в pending.json и будут переведены следующим прогоном`;
  console.log(`::warning::${msg}`);
  if (strict) {
    console.error(`::error::${msg} (--strict)`);
    process.exitCode = 1;
  }
} else {
  console.log('i18n-translate: всё покрыто русским переводом.');
}
process.exit(process.exitCode || 0);
