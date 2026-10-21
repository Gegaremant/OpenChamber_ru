#!/usr/bin/env node
// Выгружает все ключи, для которых EN-блок есть, а RU-блока нет.
// Формат: @@MODULE <файл>  →  <ключ> = <EN-значение>
// Использует ту же логику разбора, что и i18n-check.mjs (обе кавычки).
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: extract-missing.mjs <messages_dir>'); process.exit(2); }

function stringKeys(text) {
  const out = [];
  const re = /^[\t ]*(['"])([-\w.]+)\1\s*:/gm;
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(re.lastIndex).replace(/^\s*/, '');
    if (rest[0] === '{') continue;
    out.push(m[2]);
  }
  return out;
}

function inner(text, code) {
  const re = new RegExp(`^[ \\t]*${code}: \\{`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  let open = m.index + m[0].length - 1;
  let d = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') d++;
    else if (text[i] === '}') { d--; if (d === 0) return text.slice(open + 1, i); }
  }
  return null;
}

// значение ключа в плоском блоке: одинарные или двойные кавычки
function valueOf(inner, key) {
  const esc = key.replace(/[.]/g, '\\.');
  const re = new RegExp(`^([\\t ]*)['\\"]${esc}['\\"]\\s*:\\s*(['"])([\\s\\S]*?)\\2\\s*,?[\\t ]*$`, 'm');
  const m = inner.match(re);
  if (!m) return null;
  return m[3];
}

let out = '';
let modules = 0, keys = 0;
for (const f of fs.readdirSync(dir).filter((x) => /\.i18n\.ts$/.test(x)).sort()) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const enInner = inner(text, 'en');
  const ruInner = inner(text, 'ru');
  if (!enInner) continue;
  if (ruInner === null) { out += `@@MODULE ${f} — NO-RU-BLOCK\n`; modules++; continue; }
  const enKeys = stringKeys(enInner);
  const ruSet = new Set(stringKeys(ruInner));
  const missed = enKeys.filter((k) => !ruSet.has(k));
  if (!missed.length) continue;
  modules++;
  for (const k of missed) {
    const v = valueOf(enInner, k) ?? '<НЕ НАЙДЕНО>';
    out += `@@MODULE ${f}\n${k} = ${v}\n`;
    keys++;
  }
}

// сами большие словари: en.ts vs ru.ts и en.settings.ts vs ru.settings.ts
for (const [en, ru, label] of [['en.ts', 'ru.ts', 'main'], ['en.settings.ts', 'ru.settings.ts', 'settings']]) {
  const enText = fs.readFileSync(path.join(dir, en), 'utf8');
  const ruText = fs.readFileSync(path.join(dir, ru), 'utf8');
  const enKeys = stringKeys(enText);
  const ruSet = new Set(stringKeys(ruText));
  const missed = enKeys.filter((k) => !ruSet.has(k));
  if (!missed.length) continue;
  modules++;
  for (const k of missed) {
    const v = valueOf(enText, k) ?? '<НЕ НАЙДЕНО>';
    out += `@@MODULE ${label}\n${k} = ${v}\n`;
    keys++;
  }
}

const outFile = path.join(process.argv[3] || '.', 'missing-ru.tsv');
fs.writeFileSync(outFile, out);
console.log(`модулей/словарей с пропусками: ${modules}, ключей: ${keys} → ${outFile}`);
