#!/usr/bin/env node
// Проверка полноты русской локали: для каждого EN-ключа основного и settings
// словаря, а также интеграционных i18n файлов (en-блок vs ru-блок) убеждается,
// что в RU есть перевод. Печатает отчёт. Выход: 0 — всё переведено, 1 — есть пропуски.
import fs from 'node:fs';
import path from 'node:path';

const messagesDir = process.argv[2];
if (!messagesDir) {
  console.error('usage: node i18n-check.mjs <messages_dir>');
  process.exit(2);
}

const read = (p) => fs.readFileSync(path.join(messagesDir, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(messagesDir, p));

const IGNORED = new Set(['onboarding.localSetup.windows.stepInstallWslSuffix']);

// Все ключи-строки в тексте (плоский словарь; ключ объекта локали отбрасывается).
function stringKeys(text) {
  const out = [];
  const re = /^[\t ]*'([\w.]+)'\s*:/gm;
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(re.lastIndex).replace(/^\s*/, '');
    if (rest[0] === '{') continue; // вложенный объект (блок локали)
    out.push(m[1]);
  }
  return out;
}

// Тело { ... } блока, начинающегося с regexp-позиции codeIdx (указывает на '{').
function blockInner(text, codeIdx) {
  let depth = 0;
  for (let i = codeIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(codeIdx + 1, i);
    }
  }
  return null;
}

// Ключи блока локали 'code:' (на верхнем уровне файла, отступ 2 пробела).
function localeBlockKeys(text, code) {
  const re = new RegExp(`^  ${code}: \\{`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const openBrace = m.index + m[0].length - 1;
  const inner = blockInner(text, openBrace);
  if (inner === null) return null;
  return stringKeys(inner);
}

function checkFlat(enFile, ruFile, label) {
  const enSet = new Set(stringKeys(read(enFile)));
  const ruSet = new Set(stringKeys(read(ruFile)));
  const missing = [...enSet].filter((k) => !ruSet.has(k) && !IGNORED.has(k));
  const extras = [...ruSet].filter((k) => !enSet.has(k));
  console.log(`=== ${label} === EN ${enSet.size} / RU ${ruSet.size}`);
  if (missing.length) {
    console.warn(`  MISSING ${missing.length}: ${missing.slice(0, 200).join(', ')}`);
    return 1;
  }
  console.log('  MISSING 0');
  if (extras.length) console.log(`  EXTRAS  ${extras.length}`);
  return 0;
}

function checkLinear(file, label) {
  const text = read(file);
  const enKeys = localeBlockKeys(text, 'en') || [];
  const ruKeys = localeBlockKeys(text, 'ru');
  if (ruKeys === null) {
    console.log(`=== ${label} === EN ${enKeys.length} / RU-block нет`);
    console.warn(`  MISSING ${enKeys.length}: русский блок (ru:) не найден`);
    return 1;
  }
  const ruSet = new Set(ruKeys);
  const missing = [...enKeys].filter((k) => !ruSet.has(k) && !IGNORED.has(k));
  const extras = [...ruSet].filter((k) => !enKeys.includes(k));
  console.log(`=== ${label} === EN ${enKeys.length} / RU-block ${ruKeys.length}`);
  if (missing.length) {
    console.warn(`  MISSING ${missing.length}: ${missing.slice(0, 200).join(', ')}`);
    return 1;
  }
  console.log('  MISSING 0');
  if (extras.length) console.log(`  EXTRAS  ${extras.length}`);
  return 0;
}

let hasMissing = false;
for (const { en, ru, label } of [
  { en: 'en.ts', ru: 'ru.ts', label: 'main dict' },
  { en: 'en.settings.ts', ru: 'ru.settings.ts', label: 'settings dict' },
]) {
  if (!exists(en)) { console.log(`  — ${label}: нет ${en}`); continue; }
  hasMissing |= checkFlat(en, ru, label);
}
for (const { file, label } of [
  { file: 'linear-integration.i18n.ts', label: 'linear-integration' },
  { file: 'linear-issue-picker.i18n.ts', label: 'linear-issue-picker' },
  { file: 'linear-panel.i18n.ts', label: 'linear-panel' },
]) {
  if (!exists(file)) { console.log(`  — ${label}: нет ${file}`); continue; }
  hasMissing |= checkLinear(file, label);
}

process.exit(hasMissing ? 1 : 0);