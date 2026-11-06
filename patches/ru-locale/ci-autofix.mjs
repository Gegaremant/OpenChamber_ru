#!/usr/bin/env node
// CI-самолечение: запускает команду и, если она падает, просит LLM починить
// патчер. Правки разрешены только внутри patches/ru-locale (кроме больших
// словарей ru.ts / ru.settings.ts), проверяются на синтаксис и откатываются,
// если после них команда всё равно падает.
//
//   node ci-autofix.mjs --command "bash patches/ru-locale/apply-ru-locale.sh 2.6.1 build-source" \
//        [--cwd .] [--patches patches/ru-locale] [--attempts 3] \
//        [--context .github/workflows/build-ru.yml] [--max-log-lines 300]
//
// Окружение — те же TRANSLATE_API_* / TRANSLATE_* секреты, что у
// i18n-translate.mjs. Без ключа команда просто выполняется один раз.
//
// Выход: 0 — команда прошла (с правками или без), 1 — починить не удалось.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Аргументы
// ============================================================

function parseArgs(argv) {
  const out = {
    cwd: process.cwd(),
    patches: 'patches/ru-locale',
    command: '',
    attempts: 3,
    maxLogLines: 300,
    context: [],
    timeBudgetMs: 45 * 60_000,
    requestTimeoutMs: 180_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--command') out.command = next();
    else if (a === '--cwd') out.cwd = next();
    else if (a === '--patches') out.patches = next();
    else if (a === '--attempts') out.attempts = Number(next());
    else if (a === '--max-log-lines') out.maxLogLines = Number(next());
    else if (a === '--context') out.context.push(next());
    else if (a === '--time-budget-ms') out.timeBudgetMs = Number(next());
    else if (a === '--request-timeout-ms') out.requestTimeoutMs = Number(next());
    else if (a === '--help' || a === '-h') {
      console.log('usage: node ci-autofix.mjs --command "<shell>" [--cwd DIR] [--patches DIR] [--attempts N] [--context FILE]...');
      process.exit(0);
    } else {
      console.error(`ci-autofix: неизвестный аргумент ${a}`);
      process.exit(2);
    }
  }
  if (!out.command) {
    console.error('ci-autofix: нужен --command');
    process.exit(2);
  }
  out.cwd = path.resolve(out.cwd);
  out.patches = path.resolve(out.cwd, out.patches);
  return out;
}

const args = parseArgs(process.argv.slice(2));
const deadline = Date.now() + args.timeBudgetMs;
const budgetLeft = () => deadline - Date.now();

// ============================================================
// Конфигурация LLM
// ============================================================

const apiKey = process.env.TRANSLATE_API_KEY;
const apiUser = process.env.TRANSLATE_API_USER;
const apiPass = process.env.TRANSLATE_API_PASS;
const hasAuth = Boolean(apiKey || apiPass);
const base = (process.env.TRANSLATE_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');

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
      signal: AbortSignal.timeout(Math.min(args.requestTimeoutMs, 30_000)),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.data)) return [];
    return data.data
      .map((m) => m && m.id)
      .filter((id) => typeof id === 'string' && id && !SKIP_MODEL_RE.test(id));
  } catch {
    return [];
  }
}

let models = configuredModels;
if (hasAuth) {
  const discovered = await discoverModels();
  if (discovered.length) models = [...new Set([...configuredModels, ...discovered])];
}
let modelIndex = 0;

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

async function callLLM(userPrompt) {
  let lastError = null;
  const maxTries = Math.min(models.length, Number(process.env.AUTOFIX_MAX_MODEL_TRIES || 15));
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const model = models[(modelIndex + attempt) % models.length];
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'Ты — инженер CI репозитория OpenChamber_ru. Возвращай только JSON без markdown. '
                + 'Ты чинишь патчер русской локали, а не собранное дерево.',
            },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0,
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(args.requestTimeoutMs),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${raw.slice(0, 300)}`;
        continue;
      }
      let data;
      try { data = JSON.parse(raw); } catch { lastError = `не JSON: ${raw.slice(0, 200)}`; continue; }
      const content = extractContent(data);
      if (!content.trim()) { lastError = 'пустой ответ'; continue; }
      modelIndex = (modelIndex + attempt) % models.length;
      console.log(`ci-autofix: ответила модель ${model}`);
      return content;
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError || 'ни одна модель не ответила');
}

// ============================================================
// Запуск команды
// ============================================================

function runCommand(command) {
  console.log(`\n$ ${command}`);
  const r = spawnSync(command, {
    cwd: args.cwd,
    shell: '/bin/bash',
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    timeout: 0,
    env: { ...process.env, CI_AUTOFIX: '1' },
  });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  if (output) process.stdout.write(output.endsWith('\n') ? output : output + '\n');
  return { status: r.status ?? 1, output };
}

// ============================================================
// Файлы: контекст и песочница правок
// ============================================================

const PATCH_SCRIPTS = ['i18n-translate.mjs', 'i18n-check.mjs', 'i18n-sync-dicts.mjs',
  'patch-locale-records.mjs', 'apply-ru-locale.sh', 'append-ru-keys.mjs',
  'extract-missing.mjs', 'patch-menu.mjs', 'readme-sync.mjs'];

const FORBIDDEN_NAMES = new Set(['ru.ts', 'ru.settings.ts']);
const MAX_FILE_CHARS = 70_000;
const MAX_CONTEXT_CHARS = 240_000;

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveEditable(rawPath) {
  const candidates = [
    path.resolve(args.cwd, rawPath),
    path.resolve(args.patches, rawPath),
  ];
  for (const abs of candidates) {
    if (!isInside(args.patches, abs)) continue;
    if (FORBIDDEN_NAMES.has(path.basename(abs))) continue;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    return fs.realpathSync(abs);
  }
  return null;
}

function editableGroups() {
  const groups = [];
  // Скрипты — основной объект починки.
  for (const name of PATCH_SCRIPTS) {
    const abs = path.join(args.patches, name);
    if (fs.existsSync(abs)) groups.push(abs);
  }
  // Доноры модулей: их тоже можно править (но не ru.ts/settings).
  for (const name of fs.readdirSync(args.patches)) {
    if (!name.endsWith('.i18n.ts')) continue;
    groups.push(path.join(args.patches, name));
  }
  return [...new Set(groups)].filter((p) => !FORBIDDEN_NAMES.has(path.basename(p)));
}

function readForContext(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const rel = path.relative(args.cwd, abs);
  if (text.length > MAX_FILE_CHARS) {
    return `### ${rel} (обрезано, всего ${text.length} символов)\n\`\`\`\n${text.slice(0, MAX_FILE_CHARS)}\n\`\`\``;
  }
  return `### ${rel}\n\`\`\`\n${text}\n\`\`\``;
}

function buildFileContext() {
  const parts = [];
  let total = 0;
  for (const abs of editableGroups()) {
    const chunk = readForContext(abs);
    if (total + chunk.length > MAX_CONTEXT_CHARS) break;
    parts.push(chunk);
    total += chunk.length;
  }
  for (const rel of args.context) {
    const abs = path.resolve(args.cwd, rel);
    if (!isInside(args.cwd, abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const chunk = readForContext(abs);
    if (total + chunk.length > MAX_CONTEXT_CHARS) break;
    parts.push(chunk);
    total += chunk.length;
  }
  return parts.join('\n\n');
}

// ============================================================
// Разбор ответа и применение правок
// ============================================================

function parseReply(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('в ответе нет JSON-объекта');
  const obj = JSON.parse(t.slice(first, last + 1));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('ответ не объект');
  const edits = Array.isArray(obj.edits) ? obj.edits : [];
  return { diagnosis: String(obj.diagnosis || ''), edits };
}

function validateFile(abs) {
  const ext = path.extname(abs);
  if (ext === '.mjs' || ext === '.js' || ext === '.cjs') {
    const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
    return r.status === 0 ? null : `${path.basename(abs)}: ${(r.stderr || r.stdout || '').slice(0, 500)}`;
  }
  if (ext === '.sh' || ext === '.bash') {
    const r = spawnSync('bash', ['-n', abs], { encoding: 'utf8' });
    return r.status === 0 ? null : `${path.basename(abs)}: ${(r.stderr || r.stdout || '').slice(0, 500)}`;
  }
  if (ext === '.json') {
    try { JSON.parse(fs.readFileSync(abs, 'utf8')); return null; } catch (e) { return `${path.basename(abs)}: ${e.message}`; }
  }
  return null;
}

function applyEdits(edits, attempt) {
  const staged = [];
  const backupRoot = path.join(args.patches, '.autofix-backup', `${Date.now()}-try${attempt}`);
  const problems = [];

  for (const [index, edit] of edits.entries()) {
    if (!edit || typeof edit.path !== 'string' || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
      problems.push(`правка #${index + 1}: нужны строковые path/find/replace`);
      continue;
    }
    const abs = resolveEditable(edit.path);
    if (!abs) {
      problems.push(`правка #${index + 1}: путь вне patches/ru-locale или файл запрещён/не найден (${edit.path})`);
      continue;
    }
    const before = fs.readFileSync(abs, 'utf8');
    const count = before.split(edit.find).length - 1;
    if (count !== 1) {
      problems.push(`правка #${index + 1}: find встречается ${count} раз в ${path.relative(args.cwd, abs)} (нужен ровно 1)`);
      continue;
    }
    const after = before.replace(edit.find, () => edit.replace);
    if (after === before) {
      problems.push(`правка #${index + 1}: ничего не изменилось`);
      continue;
    }
    staged.push({ abs, before, after, rel: path.relative(args.cwd, abs) });
    // В памяти сохраняем накопительный результат для повторных правок файла.
    fs.writeFileSync(abs, after);
  }

  if (!staged.length) return { ok: false, problems, staged: [] };

  const syntax = [];
  for (const abs of new Set(staged.map((s) => s.abs))) {
    const err = validateFile(abs);
    if (err) syntax.push(err);
  }
  if (syntax.length) {
    // Откатываем всё и сообщаем модели, что именно не скомпилировалось.
    for (const s of [...staged].reverse()) fs.writeFileSync(s.abs, s.before);
    return { ok: false, problems: [...problems, ...syntax], staged: [] };
  }

  // Бэкап исходников — на случай ручного разбора после неудачи.
  for (const s of staged) {
    const dest = path.join(backupRoot, path.relative(args.cwd, s.abs));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, s.before);
  }
  return { ok: true, problems, staged };
}

function revertAll(history) {
  for (const attempt of [...history].reverse()) {
    for (const s of [...attempt.staged].reverse()) {
      try { fs.writeFileSync(s.abs, s.before); } catch { /* файл мог исчезнуть */ }
    }
  }
}

// ============================================================
// Промпт
// ============================================================

function tail(text, lines) {
  const all = String(text || '').split('\n');
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}

function buildPrompt({ command, status, output, attempt, history, feedback }) {
  const historyText = history.length
    ? history.map((h, i) => `Попытка ${i + 1}: ${h.diagnosis || '(без диагноза)'}\n`
      + h.staged.map((s) => `  • ${s.rel}`).join('\n')).join('\n')
    : '(пока нет)';

  return `Команда сборки упала. Почини патчер.

## Упавшая команда
\`\`\`
${command}
\`\`\`
Код возврата: ${status}
Номер попытки: ${attempt}/${args.attempts}

## Хвост лога (${args.maxLogLines} строк)
\`\`\`
${tail(output, args.maxLogLines)}
\`\`\`

## Что уже пробовали
${historyText}

${feedback ? `## Ошибка применения прошлых правок\n${feedback}\n` : ''}

## Файлы патчера
${buildFileContext()}

## Правила
1. Правь только файлы внутри patches/ru-locale. НЕ трогай ru.ts и ru.settings.ts — они слишком большие, их наполняет i18n-translate.mjs.
2. Пути указывай относительно корня репозитория, например patches/ru-locale/apply-ru-locale.sh.
3. Правка — это точная строка find, которая встречается в файле РОВНО один раз, и replace.
4. Не ослабляй проверки молча: если проверка мешает из-за изменившейся структуры апстрима, научи её находить новую структуру, а не удаляй.
5. Все правки должны быть идемпотентны: повторный прогон не должен дублировать вставки.
6. Никаких команд, сетевых вызовов и удаления файлов — только edits.
7. Если по логу нельзя починить патчер, верни пустой edits и честный diagnosis.

## Формат ответа (только JSON)
{"diagnosis":"кратко, что сломалось","edits":[{"path":"patches/ru-locale/apply-ru-locale.sh","find":"точный фрагмент","replace":"новый фрагмент"}]}`;
}

// ============================================================
// Основной цикл
// ============================================================

console.log(`ci-autofix: cwd=${args.cwd}`);
console.log(`ci-autofix: patches=${args.patches}`);
console.log(`ci-autofix: моделей ${models.length}${hasAuth ? '' : ' (нет ключа — авторемонт выключен)'}`);

let first = runCommand(args.command);
if (first.status === 0) {
  console.log('ci-autofix: команда прошла без правок.');
  process.exit(0);
}
if (!hasAuth) {
  console.error('ci-autofix: команда упала, но TRANSLATE_API_KEY/PASS не задан — авторемонт невозможен.');
  process.exit(first.status || 1);
}

const history = [];
let feedback = '';
let lastStatus = first.status;
let lastOutput = first.output;

for (let attempt = 1; attempt <= args.attempts; attempt++) {
  if (budgetLeft() <= 0) {
    console.warn('ci-autofix: исчерпан бюджет времени.');
    break;
  }
  console.log(`\nci-autofix: попытка ремонта ${attempt}/${args.attempts}`);
  let reply;
  try {
    reply = await callLLM(buildPrompt({
      command: args.command,
      status: lastStatus,
      output: lastOutput,
      attempt,
      history,
      feedback,
    }));
  } catch (e) {
    console.warn(`ci-autofix: LLM недоступен (${e.message}) — прекращаю ремонт.`);
    break;
  }

  let parsed;
  try {
    parsed = parseReply(reply);
  } catch (e) {
    feedback = `Не удалось разобрать JSON: ${e.message}`;
    console.warn(`ci-autofix: ${feedback}`);
    continue;
  }

  console.log(`ci-autofix: диагноз: ${parsed.diagnosis || '(пусто)'}`);
  if (!parsed.edits.length) {
    console.warn('ci-autofix: модель не предложила правок.');
    break;
  }

  const applied = applyEdits(parsed.edits, attempt);
  if (!applied.ok) {
    feedback = applied.problems.join('\n');
    console.warn(`ci-autofix: правки не применены:\n${feedback}`);
    continue;
  }

  const record = { diagnosis: parsed.diagnosis, staged: applied.staged };
  history.push(record);
  for (const s of applied.staged) console.log(`  ✎ ${s.rel}`);

  const result = runCommand(args.command);
  lastStatus = result.status;
  lastOutput = result.output;
  if (result.status === 0) {
    console.log('\nci-autofix: команда починена автоматически.');
    console.log('ci-autofix: изменённые файлы:');
    for (const s of applied.staged) console.log(`  - ${s.rel}`);
    process.exit(0);
  }
  feedback = '';
  console.warn(`ci-autofix: после правок команда всё ещё падает (код ${result.status}).`);
}

// Не оставляем полупочинку: она сломает артефакт и следующие джобы.
revertAll(history);
console.error('ci-autofix: починить не удалось за отведённые попытки, правки откачены.');
process.exit(lastStatus || 1);
