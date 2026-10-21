#!/usr/bin/env node
/**
 * Синхронизирует README.md с версией релиза.
 *
 * Что правит:
 *   1. Строку «Актуальная версия: vX.Y.Z»
 *   2. Блок ссылок «Скачать» (теги /releases/download/vX и имена файлов
 *      OpenChamber_ru-X) — только между «## Скачать» и «### Все выпущенные»
 *   3. Диапазон в «Показать таблицу релизов v… – v…»
 *   4. Добавляет строку нового релиза в таблицу выпущенных версий
 *      (если её ещё нет — повторный прогон не плодит дубликаты)
 *
 * Использование: node readme-sync.mjs <2.5.0> <README.md>
 */
import fs from 'node:fs';

const version = process.argv[2];
const readmePath = process.argv[3];
if (!version || !readmePath) {
  console.error('usage: readme-sync.mjs <version> <README.md>');
  process.exit(2);
}
if (!/^v?\d+\.\d+\.\d+$/.test(`v${version}`.replace(/^v/, ''))) {
  console.error(`плохая версия: ${version}`);
  process.exit(2);
}
const v = version.replace(/^v/, '');
const tag = `v${v}`;
const gh = 'https://github.com/Gegaremant/OpenChamber_ru/releases';

let s = fs.readFileSync(readmePath, 'utf8');
const before = s;
const changedSets = [];

// 1. Актуальная версия
s = s.replace(/\*\*Актуальная версия: v\d+\.\d+\.\d+\*\*/, `**Актуальная версия: ${tag}**`);

// 2. Блок ссылок «Скачать» — только внутри секции.
const d0 = s.indexOf('## Скачать');
const d1 = s.indexOf('### Все выпущенные версии');
if (d0 >= 0 && d1 > d0) {
  const block = s.slice(d0, d1)
    .replace(/\/releases\/download\/v\d+\.\d+\.\d+\//g, `/releases/download/${tag}/`)
    .replace(/OpenChamber_ru-\d+\.\d+\.\d+-/g, `OpenChamber_ru-${v}-`);
  s = s.slice(0, d0) + block + s.slice(d1);
}

// 3. Диапазон в подписи свёрнутого списка
s = s.replace(/(Показать таблицу релизов v\d+\.\d+\.\d+ – )v\d+\.\d+\.\d+/, `$1${tag}`);

// 4. Строка нового релиза в таблице выпущенных.
const newRow = `| ${tag} | [AppImage](${gh}/download/${tag}/OpenChamber_ru-${v}-linux-x86_64.AppImage) ` +
  `| [EXE](${gh}/download/${tag}/OpenChamber_ru-${v}-win-x64.exe) ` +
  `| [DMG](${gh}/download/${tag}/OpenChamber_ru-${v}-mac-x64.dmg)` +
  ` · [ZIP](${gh}/download/${tag}/OpenChamber_ru-${v}-mac-x64.zip) ` +
  `| [APK](${gh}/download/${tag}/OpenChamber_ru-${v}-android.apk) |`;
const sep = '|--------|-------|---------|-------|---------|\n';
if (!s.includes(`| ${tag} |`)) {
  const si = s.indexOf(sep);
  if (si >= 0) s = s.slice(0, si + sep.length) + newRow + '\n' + s.slice(si + sep.length);
  else console.error('::warning::не нашёл сепаратор таблицы релизов — строка не добавлена');
}

if (s === before) {
  console.log(`  README уже на ${tag}`);
  process.exit(0);
}
fs.writeFileSync(readmePath, s);
console.log(`  ✓ README синхронизирован с ${tag}`);
