#!/usr/bin/env node
/**
 * Дописывает ключи в ru-блоки донорских patch-файлов (*.i18n.ts из patches/).
 * Вход: ключи в missing-ru.json рядом со скриптом + путь к каталогу.
 * Идемпотентно: ключ уже есть в ru-блоке — пропускается с предупреждением.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: append-ru-keys.mjs <messages_dir>'); process.exit(2); }

const jsonFile = path.join(path.dirname(new URL(import.meta.url).pathname), 'missing-ru.json');
const entries = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

const esc = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

let files = 0, added = 0, skipped = 0;
for (const [file, list] of Object.entries(entries)) {
  const f = path.join(dir, file);
  if (!fs.existsSync(f)) { console.error(`  ✗ ${file}: нет файла`); process.exit(1); }
  let src = fs.readFileSync(f, 'utf8');
  const m = src.match(/^([ \t]*)ru: \{[\s\S]*?^\1\},\n/m);
  if (!m) { console.error(`  ✗ ${file}: ru-блок не найден`); process.exit(1); }
  const indent = m[1];
  const closing = indent + '},\n';
  if (!m[0].endsWith(closing)) { console.error(`  ✗ ${file}: неадекватный хвост ru-блока`); process.exit(1); }

  const ruSet = new Set(
    [...m[0].matchAll(/^[\t ]*(['"])([\w.]+)\1\s*:/gm)].map((x) => x[2])
  );

  const additions = [];
  for (const [key, value] of list) {
    if (ruSet.has(key)) { console.warn(`  → ${file}: ${key} уже есть, пропущен`); skipped++; continue; }
    additions.push(`${indent}  '${key}': '${esc(value)}',\n`);
    ruSet.add(key);
  }
  if (!additions.length) { console.log(`  ${file}: без пополнения`); continue; }
  const insertAt = m[0].length - closing.length;
  const newBlock = m[0].slice(0, insertAt) + additions.join('') + closing;
  src = src.slice(0, m.index) + newBlock + src.slice(m.index + m[0].length);
  fs.writeFileSync(f, src);
  files++;
  added += additions.length;
}
console.log(`  ✓ пополнено файлов: ${files}, ключей: ${added}, пропущено (дубли): ${skipped}`);
