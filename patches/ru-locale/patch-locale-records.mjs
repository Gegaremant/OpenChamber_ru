#!/usr/bin/env node
// Детерминированно закрывает дыры типа Record<Locale, ...> после добавления 'ru'.
//
//   node patch-locale-records.mjs [repo_root]
//
// Зачем: как только в тип Locale попадает 'ru', каждый объект, типизированный
// как Record<Locale, ...> (или Record<Exclude<Locale, 'en'>, ...>), обязан
// содержать ключ ru. Апстрим добавляет такие объекты в новых версиях
// (v2.6.1: LOCALE_LABEL_KEYS, lines.test.ts, easterEggCopy.ts), и сборка
// падает на TS2741/TS2739. Скрипт находит их по аннотации/`satisfies` и
// вставляет ru, клонируя значение английской (или первой доступной) локали.
//
// Правила выбора значения:
//   • есть en: — клонируем его выражение (ru: en, ru: null, ru: EN_MESSAGES);
//   • нет en: (Record<Exclude<Locale,'en'>>) — берём de/первую запись, но
//     динамический import('./.../<lang>') переписываем на en, если такой
//     файл существует (иначе русские пасхалки были бы немецкими);
//   • строка 'common.language.english' превращается в 'common.language.russian'.
//
// Скрипт идемпотентен: объект, где ru уже есть, не трогается.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'build', '.git', '.turbo', 'coverage', 'release']);
const ALLOWED_EXT = new Set(['.ts', '.tsx', '.mts', '.cts']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && ALLOWED_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Пропускает строку/комментарий вперёд; возвращает индекс за литералом. */
function skipForward(text, i) {
  const c = text[i];
  if (c === '"' || c === "'" || c === '`') {
    const quote = c;
    i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === quote) return i + 1;
      i++;
    }
    return i;
  }
  if (c === '/' && text[i + 1] === '/') {
    const nl = text.indexOf('\n', i + 2);
    return nl < 0 ? text.length : nl + 1;
  }
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i + 1;
}

/** Индекс закрывающей скобки для { или [ с учётом строк и комментариев. */
function findMatching(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipForward(text, i); continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) { i = skipForward(text, i); continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

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
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Разбирает верхнеуровневые записи объекта: key -> raw value.
 * Понимает несколько записей в одной строке (ExtensionsPage) и сокращённую
 * запись `en, de, ...` (lines.test.ts). Значения читаются до запятой
 * верхнего уровня с учётом строк, комментариев и вложенных скобок.
 */
function parseEntries(text, open, close) {
  const inner = text.slice(open + 1, close);
  const entries = [];
  const n = inner.length;
  let i = 0;

  const readKey = () => {
    const c = inner[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const start = ++i;
      while (i < n) {
        if (inner[i] === '\\') { i += 2; continue; }
        if (inner[i] === quote) break;
        i++;
      }
      const key = inner.slice(start, i);
      i++;
      return key;
    }
    const start = i;
    while (i < n && /[A-Za-z0-9_$-]/.test(inner[i])) i++;
    return inner.slice(start, i);
  };

  while (i < n) {
    i = skipTrivia(inner, i);
    if (i >= n) break;
    if (inner[i] === ',') { i++; continue; }

    const keyStart = i;
    const key = readKey();
    if (!key) { i++; continue; }
    i = skipTrivia(inner, i);

    let value;
    if (inner[i] === ':') {
      i++;
      i = skipTrivia(inner, i);
      const valStart = i;
      let depth = 0;
      while (i < n) {
        const c = inner[i];
        if (c === '"' || c === "'" || c === '`') {
          const quote = c;
          i++;
          while (i < n) {
            if (inner[i] === '\\') { i += 2; continue; }
            if (inner[i] === quote) { i++; break; }
            i++;
          }
          continue;
        }
        if (c === '/' && (inner[i + 1] === '/' || inner[i + 1] === '*')) {
          i = skipTrivia(inner, i);
          continue;
        }
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
        else if (c === ',' && depth === 0) break;
        i++;
      }
      value = inner.slice(valStart, i).trim().replace(/\s*\/\/[^\n]*$/, '').trim();
    } else {
      // Сокращённая запись: { en, de, ... }.
      value = key;
    }

    const lineStart = inner.lastIndexOf('\n', keyStart) + 1;
    const indent = (inner.slice(lineStart, keyStart).match(/^[ \t]*/) || [''])[0];
    entries.push({ key, value, indent });
  }
  return entries;
}

function importFileExists(fromFile, spec) {
  if (!spec.startsWith('.')) return false;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return true;
  }
  return false;
}

/** Подбирает значение для ru на основе существующих записей. */
function pickRuValue(file, entries, isExcludeEn) {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const source = byKey.get('en') || byKey.get('de') || entries[0];
  if (!source) return null;
  let value = source.value;

  // Ярлык языка: у ru должен быть свой ключ, а не английский.
  if (/^['"]common\.language\.english['"]$/.test(value)) {
    const q = value[0];
    return `${q}common.language.russian${q}`;
  }

  // Код Intl-локали: INTL_LOCALE_BY_LOCALE. Если скрипт запущен до
  // apply-ru-locale.sh, клонировать 'en-US' бессмысленно.
  if (/^['"]en(?:[-_][A-Za-z]+)?['"]$/.test(value)) return "'ru-RU'";

  // Именованные константы начальной загрузки: EN_MESSAGES -> RU_MESSAGES.
  if (/^EN(?:_[A-Z0-9_]+)?$/.test(value)) return value.replace(/^EN/, 'RU');

  // Динамический импорт пасхалок: для ru берём английский набор, если он
  // есть, вместо немецкого/первого попавшегося.
  const importMatch = value.match(/^([\s\S]*?import\(\s*)(['"])([^'"]+)\2(\s*\)[\s\S]*)$/);
  if (importMatch && source.key !== 'en') {
    const [, before, quote, spec, after] = importMatch;
    const segments = spec.split('/');
    segments[segments.length - 1] = 'en';
    const enSpec = segments.join('/');
    if (enSpec !== spec && importFileExists(file, enSpec)) {
      value = `${before}${quote}${enSpec}${quote}${after}`;
    }
  } else if (isExcludeEn && source.key === 'en') {
    // Теоретически недостижимо, но пусть будет явно.
    value = source.value;
  }

  return value;
}

/** Находит объект-литерал, к которому относится запись Record<Locale...>. */
function findTargetObject(text, pos) {
  const before = text.slice(Math.max(0, pos - 32), pos);
  const isSatisfies = /\bsatisfies\s*$/.test(before);
  const isAnnotation = /:\s*$/.test(before);

  if (isSatisfies) {
    // Объект заканчивается перед `satisfies`: ищем его присваивание назад.
    const windowStart = Math.max(0, pos - 4000);
    const region = text.slice(windowStart, pos);
    const re = /=\s*\{/g;
    let m;
    let last = null;
    while ((m = re.exec(region))) last = m;
    if (!last) return null;
    const open = windowStart + last.index + last[0].lastIndexOf('{');
    const close = findMatching(text, open);
    if (close < 0 || close > pos) return null;
    return { open, close };
  }

  if (isAnnotation) {
    // После типа идёт `= {`. `=>` не подходит: regex требует именно `=\s*{`.
    const windowEnd = Math.min(text.length, pos + 4000);
    const region = text.slice(pos, windowEnd);
    const m = /=\s*\{/.exec(region);
    if (!m) return null;
    const open = pos + m.index + m[0].lastIndexOf('{');
    const close = findMatching(text, open);
    if (close < 0) return null;
    return { open, close };
  }

  // Record<Locale,...> как аргумент другого generic (Partial<Record<...>>),
  // в типе псевдонима или в сигнатуре — это не объект-литерал локали.
  return null;
}

function patchFile(file) {
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;

  for (let guard = 0; guard < 20; guard++) {
    const re = /Record<\s*(Exclude<\s*)?Locale\b/g;
    let target = null;
    let m;
    while ((m = re.exec(text))) {
      const obj = findTargetObject(text, m.index);
      if (!obj) continue;
      const entries = parseEntries(text, obj.open, obj.close);
      if (entries.some((e) => e.key === 'ru')) continue;
      target = { obj, entries, isExcludeEn: Boolean(m[1]) };
      break;
    }
    if (!target) break;

    const { obj, entries, isExcludeEn } = target;
    const value = pickRuValue(file, entries, isExcludeEn);
    if (!value) {
      console.warn(`::warning::${path.relative(root, file)}: не смог подобрать значение для ru — пропуск`);
      break;
    }

    // Куда вставлять: перед строкой с закрывающей скобкой.
    const closeLineStart = text.lastIndexOf('\n', obj.close) + 1;
    const indent = entries.length
      ? entries[entries.length - 1].indent
      : '  ';

    if (closeLineStart <= obj.open) {
      // Однострочный объект: { en: x } -> { en: x, ru: y }
      const insert = `${entries.length ? ', ' : ' '}ru: ${value}`;
      text = text.slice(0, obj.close) + insert + text.slice(obj.close);
    } else {
      const insert = `${indent}ru: ${value},\n`;
      text = text.slice(0, closeLineStart) + insert + text.slice(closeLineStart);
    }
    changed = true;
    console.log(`  ✓ ${path.relative(root, file)}: добавлен ru (${value.slice(0, 60)})`);
  }

  if (changed) fs.writeFileSync(file, text);
  return changed;
}

const files = walk(root);
let patched = 0;
for (const file of files) {
  if (patchFile(file)) patched++;
}

if (!patched) console.log('patch-locale-records: все Record<Locale,...> уже содержат ru.');
else console.log(`patch-locale-records: обновлено файлов — ${patched}.`);
