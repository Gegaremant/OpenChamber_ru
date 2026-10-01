#!/usr/bin/env node
/**
 * Собирает импорты и спреды русских словарей из английских.
 *
 * Зачем: на v2.0.4 `en.ts` раскидывает 12 модулей, а `ru.ts` — 3.
 * Девять модулей (routing, isolated-spaces, usage-stats и прочие) в русском
 * словаре просто отсутствовали: не хватало ни импорта, ни спреда, и 743 ключа
 * показывались по-английски. Список, выписанный руками, ко всему прочему
 * устаревал молча — пока кто-нибудь не посмотрит на ошибки tsc.
 *
 * Здесь список не выписан: он снимается с `en.ts` / `en.settings.ts` на лету,
 * поэтому новый модуль апстрима подхватывается автоматически. Единственное,
 * что нужно от человека, — ru-блок для нового модуля в patches/ru-locale.
 *
 * Модуль попадает в словарь только если в его файле уже есть блок `ru`:
 * иначе обращения `X.ru` не существует и tsc падает на свойстве. Отсутствие
 * блока не остаётся незамеченным — `apply-ru-locale.sh` проверяет это
 * отдельным утверждением и валит сборку.
 *
 * Использование: node i18n-sync-dicts.mjs <путь-к-сообщениям>
 */

import fs from 'fs';
import path from 'path';

const msgsDir = process.argv[2];
if (!msgsDir) {
  console.error('usage: i18n-sync-dicts.mjs <path-to-messages>');
  process.exit(1);
}

/** Есть ли в файле локали блок `ru: {` (а не упоминание ru где-то ещё). */
function hasRuBlock(file) {
  const src = fs.readFileSync(file, 'utf8');
  return /^[ \t]*ru: \{/m.test(src);
}

/**
 * Пересобирает целевой словарь по образцу английского.
 *
 * `en.settings` переименовывается в `ru.settings`, а `X.en` в спредах — в
 * `X.ru`. Порядок сохраняется английский, чтобы при сравнении файлов не
 * приходилось гадать, что переехало.
 */
function sync(target, source, label) {
  const src = fs.readFileSync(source, 'utf8');
  let out = fs.readFileSync(target, 'utf8');

  const skipped = [];
  const imports = [];
  for (const m of src.matchAll(/^import \{ (\w+) \} from '\.\/([\w.-]+)';$/gm)) {
    const [, name, mod] = m;
    const spec = mod === 'en.settings' ? './ru.settings' : `./${mod}`;
    // В импорте апстрим пишет './linear-panel.i18n' — уже с расширением,
    // так что на диске ищем `${mod}.ts`, а не `${mod}.i18n.ts`.
    if (mod.endsWith('.i18n') && !hasRuBlock(path.join(msgsDir, `${mod}.ts`))) {
      skipped.push(mod);
      continue;
    }
    imports.push(`import { ${name} } from '${spec}';`);
  }

  const spreads = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^(\s*)\.\.\.(\w+?)(?:\.en)?,\s*$/);
    if (!m) continue;
    const [, indent, name] = m;
    if (name === 'settingsDict') {
      spreads.push({ indent, text: '...settingsDict,' });
    } else if (imports.some((line) => line.includes(` ${name} }`))) {
      spreads.push({ indent, text: `...${name}.ru,` });
    }
  }
  if (!spreads.length) {
    console.error(`в ${source} не найдено ни одного спреда`);
    process.exit(1);
  }

  // Импорты: type-импорты оставляем как есть — от `import type { I18nKey }`
  // зависит типизация `Record<I18nKey, string>`, и его терять нельзя.
  const typeImports = out.match(/^import type .*$/gm) || [];
  const first = out.search(/^import /m);
  if (first < 0) {
    console.error(`в ${target} нет строк import`);
    process.exit(1);
  }
  const last = out.search(/^(?!import )/m, first) - 1;
  out = out.slice(0, first) + [...typeImports, ...imports].join('\n') + out.slice(last + 1);

  // Спреды: подряд идущий блок `  ...X,` меняем на сгенерированный, отступ
  // берём из первой найденной строки (в ru.settings.ts он шире, чем в ru.ts).
  const re = /^(?:[ \t]*\.\.\.\w+(?:\.ru|\.en)?,[ \t]*\n)+/m;
  if (!re.test(out)) {
    console.error(`в ${target} не найден блок спредов`);
    process.exit(1);
  }
  out = out.replace(re, spreads.map((s) => s.indent + s.text + '\n').join(''));

  fs.writeFileSync(target, out);
  const note = skipped.length ? `, без ru-блока пропущено: ${skipped.join(', ')}` : '';
  console.log(`  ✓ ${label}: импортов ${imports.length}, спредов ${spreads.length}${note}`);
  return skipped;
}

const jobs = [
  { source: 'en.ts', target: 'ru.ts', label: 'ru.ts собран из en.ts' },
  { source: 'en.settings.ts', target: 'ru.settings.ts', label: 'ru.settings.ts собран из en.settings.ts' },
];

let missing = 0;
for (const job of jobs) {
  const source = path.join(msgsDir, job.source);
  const target = path.join(msgsDir, job.target);
  if (!fs.existsSync(source) || !fs.existsSync(target)) {
    console.error(`  ✗ ${job.label}: нет ${!fs.existsSync(source) ? job.source : job.target}`);
    missing++;
    continue;
  }
  missing += sync(target, source, job.label).length;
}

if (missing) {
  console.error(`  ✗ не хватает ru-блоков: ${missing}. Добавьте их в patches/ru-locale или снимите I18N_STRICT`);
  process.exit(1);
}
