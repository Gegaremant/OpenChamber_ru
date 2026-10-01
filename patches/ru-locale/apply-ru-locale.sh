#!/bin/bash
set -euo pipefail

# ============================================================
# OpenChamber RU — скрипт добавления русской локали
#
# Режим 1 (standalone): ./apply-ru-locale.sh [version] [build_dir]
#   Клонирует оригинальный OpenChamber и добавляет русский язык
#
# Режим 2 (in-workflow): apply-ru-locale.sh <version> <existing_dir>
#   Если <existing_dir> уже развёрнутое дерево апстрима, клонирование
#   пропускается. Проверяется наличие .git ИЛИ package.json: рабочая
#   копия может быть распакованным архивом, и старая проверка только .git
#   отправляла такую копию в rm -rf, который отказывался удалять '.'.
# ============================================================

# Флаг неудачных проверок. Объявляем здесь, а не в финальном блоке:
# с 'set -u' обращение к неинициализированной переменной обрывает скрипт,
# а объявление в конце обнуляло бы флаг, выставленный раньше по ходу работы.
VERIFY_FAILED=0

VERSION="${1:-main}"
REPO="https://github.com/openchamber/openchamber.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${2:-/tmp/openchamber-ru-build}"

echo "=== OpenChamber RU — добавление русской локали ==="
echo "Версия: $VERSION"

# --- Клонируем (только если директория не существует) ---
# Рабочее дерево может быть распакованным архивом (без .git) — такой тоже
# считаем готовым и не трогаем его.
if [ -d "$BUILD_DIR/.git" ] || [ -f "$BUILD_DIR/package.json" ]; then
    echo "Готовая директория: $BUILD_DIR"
else
    rm -rf "$BUILD_DIR"
    echo "Клонируем оригинальный OpenChamber..."
    git clone --depth 1 --branch "v$VERSION" "$REPO" "$BUILD_DIR" 2>/dev/null || \
    git clone --depth 1 "$REPO" "$BUILD_DIR"
fi

cd "$BUILD_DIR"
echo "Рабочая директория: $(pwd)"

# ============================================================
# 1. КОПИРУЕМ НОВЫЕ ФАЙЛЫ (ru.ts, ru.settings.ts)
# ============================================================
echo ""
echo "[1/5] Копируем файлы русской локали..."
mkdir -p packages/ui/src/lib/i18n/messages
cp "$SCRIPT_DIR/ru.ts" packages/ui/src/lib/i18n/messages/ru.ts
cp "$SCRIPT_DIR/ru.settings.ts" packages/ui/src/lib/i18n/messages/ru.settings.ts
echo "  ✓ ru.ts скопирован"
echo "  ✓ ru.settings.ts скопирован"

# ============================================================
# 2. runtime.ts — добавляем 'ru' в тип, массив, лейблы и нормализацию
# ============================================================
echo ""
echo "[2/5] Модифицируем runtime.ts..."

RUNTIME_FILE="packages/ui/src/lib/i18n/runtime.ts"

# 'ru' в объединение типов и в массив LOCALES ищем по форме объявления, а не
# по точному перечню локалей. Апстрим добавляет языки и меняет их порядок
# ('nl' в v2.0.4 встал после 'fr'), и жёстко прописанный список переставал
# совпадать. perl -pi при этом молча ничего не делает: 'ru' не попадал в тип
# Locale, и следующая же подстановка — DEFAULT_LOCALE: Locale = 'ru' —
# ломала компиляцию. Здесь замена идемпотентна: повторный прогон не дублирует.
node -e "
  const fs = require('fs');
  const f = process.argv[1];
  const before = fs.readFileSync(f, 'utf8');
  let s = before;

  s = s.replace(/^(export type Locale = [^;\n]*);\$/m, (m, decl) =>
    /'ru'/.test(decl) ? m : \`\${decl} | 'ru';\`);

  s = s.replace(/(\[)('[^;\n]*?)(\] as const satisfies readonly Locale\[\])/, (m, open, body, close) =>
    /'ru'/.test(body) ? m : \`\${open}\${body}, 'ru'\${close}\`);

  if (s !== before) fs.writeFileSync(f, s);
" "$RUNTIME_FILE"

perl -0pi -e "s/'common\.language\.ukrainian' \| 'common\.language\.spanish' \| 'common\.language\.brazilianPortuguese' \| 'common\.language\.korean' \| 'common\.language\.polish' \| 'common\.language\.german' \| 'common\.language\.japanese' \| 'common\.language\.turkish'/'common.language.ukrainian' | 'common.language.spanish' | 'common.language.brazilianPortuguese' | 'common.language.korean' | 'common.language.polish' | 'common.language.german' | 'common.language.japanese' | 'common.language.turkish' | 'common.language.russian'/" "$RUNTIME_FILE"
perl -0pi -e "s/(uk: 'common\.language\.ukrainian',)(?!\n  ru: 'common\.language\.russian',)/\$1\n  ru: 'common.language.russian',/" "$RUNTIME_FILE"
perl -0pi -e "s/return 'uk';(?!\n  \}\n  if \(normalized === 'ru')/return 'uk';\n  }\n  if (normalized === 'ru' || normalized.startsWith('ru-') || normalized === 'be' || normalized.startsWith('be-')) {\n    return 'ru';/s" "$RUNTIME_FILE"
perl -0pi -e "s/export const DEFAULT_LOCALE: Locale = 'en';/export const DEFAULT_LOCALE: Locale = 'ru';/" "$RUNTIME_FILE"

echo "  ✓ runtime.ts обновлён (RU — язык по умолчанию)"

# ============================================================
# 3. store.ts — добавляем динамический импорт для 'ru'
# ============================================================
echo ""
echo "[3/5] Модифицируем store.ts..."

# (?!\n\s*: locale === 'ru') — повторный прогон иначе вклеил бы вторую ветку
# locale === 'ru' в этот тернарник.
perl -0pi -e "s/                      \? await import\('\.\/messages\/tr'\) as \{ dict: I18nDictionary \}\n                      : \{ dict: enDict \};\n  dictionaries\.set(?!\n\s*: locale === 'ru')/                      ? await import('.\/messages\/tr') as { dict: I18nDictionary }\n                      : locale === 'ru'\n                        ? await import('.\/messages\/ru') as { dict: I18nDictionary }\n                        : { dict: enDict };\n  dictionaries.set/s" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/import \{ dict as enDict, type I18nKey \} from '\.\/messages\/en';(?!\nimport \{ dict as ruDict \})/import { dict as enDict, type I18nKey } from '.\/messages\/en';\nimport { dict as ruDict } from '.\/messages\/ru';/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/\[\[DEFAULT_LOCALE, enDict\]\]/[[DEFAULT_LOCALE, ruDict]]/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/dictionaries\.set\(DEFAULT_LOCALE, enDict\);/dictionaries.set(DEFAULT_LOCALE, ruDict);/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/(  locale: DEFAULT_LOCALE,\n  )dictionary: enDict,/\$1dictionary: ruDict,/" packages/ui/src/lib/i18n/store.ts

echo "  ✓ store.ts обновлён"

# ============================================================
# 4. intl.ts — добавляем ru: 'ru-RU'
# ============================================================
echo ""
echo "[4/5] Модифицируем intl.ts..."

# (?!\s*ru:) — защита от повторной вставки. Без неё второй прогон скрипта на
# том же дереве добавлял вторую строку 'ru', и tsc падал на дубликате ключа.
perl -0pi -e "s/(uk: 'uk-UA',)(?!\s*\n?\s*ru:)/\$1\n  ru: 'ru-RU',/" packages/ui/src/lib/i18n/intl.ts

echo "  ✓ intl.ts обновлён"

# ============================================================
# 5. bootstrap.ts — добавляем RU_MESSAGES (через node.js)
# ============================================================
echo ""
echo "[5/5] Модифицируем bootstrap.ts..."

node -e "
  const fs = require('fs');
  let content = fs.readFileSync('packages/ui/src/lib/i18n/bootstrap.ts', 'utf8');

  const ruBlock = \`
const RU_MESSAGES: BootstrapMessages = {
  startingApi: 'Запуск OpenCode API…',
  initializing: 'Инициализация…',
  connecting: 'Подключение…',
  connected: 'Подключено!',
  connectionError: 'Ошибка подключения',
  disconnected: 'Отключено',
  reconnecting: 'Повторное подключение…',
  initialDataLoadFailed: 'OpenCode подключён, но не удалось выполнить начальную загрузку данных.',
  cliNotFound: 'OpenCode CLI не найден. Сначала установите его.',
  providersReady: '✓ Провайдеры',
  providersLoading: '… Провайдеры',
  agentsReady: '✓ Агенты',
  agentsLoading: '… Агенты',
  startingDevServer: (hostLabel) => \\\`Запуск dev-сервера webview (\\\${hostLabel})...\\\`,
  waitingDevServer: (hostLabel, attempt) => \\\`Ожидание dev-сервера webview (\\\${hostLabel})... попытка \\\${attempt}\\\`,
  loadingData: (providersText, agentsText) => \\\`Загрузка данных (\\\${providersText}, \\\${agentsText})…\\\`,
};

\`;

  // Обе вставки guarded: повторный прогон скрипта на том же дереве иначе
  // добавлял второе объявление RU_MESSAGES и вторую строку ru: — tsc падал
  // на дубликате.
  if (!content.includes('const RU_MESSAGES')) {
    content = content.replace(/const ES_MESSAGES:/, ruBlock + 'const ES_MESSAGES:');
  }
  if (!/\\n\\s*ru: RU_MESSAGES,/.test(content)) {
    content = content.replace(/uk: UK_MESSAGES,/, 'uk: UK_MESSAGES,\\n  ru: RU_MESSAGES,');
  }

  fs.writeFileSync('packages/ui/src/lib/i18n/bootstrap.ts', content);
  console.log('  ✓ bootstrap.ts обновлён');
"

# ============================================================
# 6. Добавляем 'common.language.russian' во все языковые файлы
# ============================================================
echo ""
echo "[бонус] Добавляем 'common.language.russian' во все локали..."

add_russian_label() {
  local file="$1"
  local label="$2"
  local filepath="packages/ui/src/lib/i18n/messages/$file"
  if [ ! -f "$filepath" ]; then
    echo "  → $file не найден, пропуск"
    return
  fi
  # Отступ и вид кавычек берём у соседней строки: прежний perl вставлял ключ
  # в колонку 0, одинарными кавычками и печатал «✓» независимо от результата.
  # Якорь — последний ключ common.language.*, а не конкретно turkish: апстрим
  # добавляет языки ('nl', 'dutch'), и привязка к одному имени переставала
  # попадать. Часть файлов (es, pt-BR, uk) использует двойные кавычки, поэтому
  # вид кавычек тоже определяем по файлу, а не задаём свой.
  if node -e "
    const fs = require('fs');
    const f = process.argv[1];
    const label = process.argv[2];
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    if (lines.some(l => l.includes('common.language.russian'))) process.exit(0);
    let at = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('common.language.') && /^\s*['\"]/.test(lines[i])) { at = i; break; }
    }
    if (at < 0) process.exit(1);
    const src = lines[at];
    const indent = (src.match(/^\s*/) || [''])[0];
    const q = (src.match(/^\s*(['\"])/) || [, \"'\"])[1];
    lines.splice(at + 1, 0, indent + q + 'common.language.russian' + q + ': ' + q + label + q + ',');
    fs.writeFileSync(f, lines.join('\n'));
  " "$filepath" "$label"; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file — не нашёлся ни один ключ common.language.*, подпись не добавлена"
    VERIFY_FAILED=1
  fi
}

# Список локалей берём с диска, а не выписываем. На v2.0.4 апстрим добавил
# нидерландский, и 'nl.ts' остался без подписи: тест messages.test.ts сверяет
# набор ключей всех локалей с английским, и один недостающий
# 'common.language.russian' ронял его. Тот же класс ошибки, что был с типом
# Locale: перечисление языков в разных местах апстрима разъезжается само.
# Главные словари — это <код>.ts; *.settings.ts и *.i18n.ts лежат рядом, но
# ключей common.language.* в них нет, и цикл их пропустит по факту.
#
# Подпись переводим на язык локали. Для нового языка, которого здесь ещё нет,
# подставляем эндоним 'Russian' и печатаем предупреждение: ключ на месте,
# сборка не падает, но перевод подписи стоит дописать.
RU_LABELS='en:Russian de:Russisch es:Ruso fr:Russe nl:Russisch ja:ロシア語 ko:러시아어 pl:Rosyjski pt-BR:Russo tr:Rusça uk:Російська zh-CN:俄语 zh-TW:俄語'

ru_label_for() {
    local code="$1" entry
    for entry in $RU_LABELS; do
        if [ "${entry%%:*}" = "$code" ]; then
            echo "${entry#*:}"
            return 0
        fi
    done
    echo "Russian"
    return 1
}

MSGS_DIR="packages/ui/src/lib/i18n/messages"
while IFS= read -r -d '' fpath; do
    fname=$(basename "$fpath")
    code="${fname%.ts}"
    # ru.ts — сам русский словарь, подпись ему не нужна.
    [ "$code" = "ru" ] && continue
    if ! grep -q "common\.language\." "$fpath"; then
        continue
    fi
    if label=$(ru_label_for "$code"); then
        add_russian_label "$fname" "$label"
    else
        add_russian_label "$fname" "Russian"
        echo "  ⚠ для локали '$code' нет перевода подписи, поставлено 'Russian' — допишите в RU_LABELS"
    fi
done < <(find "$MSGS_DIR" -maxdepth 1 -type f -name '*.ts' \
            ! -name '*.settings.ts' ! -name '*.i18n.ts' -print0 | sort)

# ============================================================
# 7. walkthrough/languages.js — добавляем ru: 'Russian'
# ============================================================
echo ""
echo "[бонус] Добавляем ru в walkthrough/languages.js..."

LANG_FILE="packages/web/server/lib/walkthrough/languages.js"
if [ -f "$LANG_FILE" ]; then
  perl -0pi -e "s/(uk: 'Ukrainian',)/\$1\n  ru: 'Russian',/" "$LANG_FILE"
  echo "  ✓ languages.js"
fi

# ============================================================
# 8. Интеграционные i18n файлы — добавляем ru блоки
# ============================================================
echo ""
echo "[бонус] Добавляем ru блоки в интеграционные i18n файлы..."

# Интеграционные i18n-файлы берём универсально: все *.i18n.ts, что есть
# в апстриме. Для каждого вклеиваем ru-блок из patches/ru-locale (если есть),
# чтобы английский текст оставался свежим от апстрима.
INTEGRATION_FILES=()
if [ -d "packages/ui/src/lib/i18n/messages" ]; then
  while IFS= read -r -d '' f; do
    INTEGRATION_FILES+=("$f")
  done < <(find packages/ui/src/lib/i18n/messages -name "*.i18n.ts" -print0 | sort)
fi

for intfile in "${INTEGRATION_FILES[@]}"; do
  filename=$(basename "$intfile")
  patch_file="$SCRIPT_DIR/$filename"
  if [ ! -f "$patch_file" ] || ! grep -qE "^[ \t]*ru: \{" "$patch_file"; then
    echo "  → $filename (ru-блок в патчах не найден, пропускаем)"
    continue
  fi
  if node -e "
    const fs = require('fs');
    const target = process.argv[1];
    const source = process.argv[2];
    const src = fs.readFileSync(source, 'utf8');
    const block = src.match(/^([ \t]*)ru: \{[\s\S]*?^\1\},\n/m);
    if (!block) { console.error('блок ru не разобран в ' + source); process.exit(1); }
    const out = fs.readFileSync(target, 'utf8');
    if (/^[ \t]*ru: \{/m.test(out)) { process.exit(0); }
    const close = out.lastIndexOf('} as const;');
    if (close < 0) { console.error('не найден закрывающий } as const;'); process.exit(1); }
    const next = out.slice(0, close) + block[0] + out.slice(close);
    const count = s => (s.match(/^[ \t]*[A-Za-z-]+: \{/gm) || []).length;
    if (count(next) !== count(out) + 1) { console.error('число языковых блоков изменилось неверно'); process.exit(1); }
    fs.writeFileSync(target, next);
  " "$intfile" "$patch_file"; then
    echo "  ✓ $filename (блок ru вклеен)"
  else
    echo "  ✗ $filename — не удалось вклеить блок ru"
    VERIFY_FAILED=1
  fi
done

# ============================================================
# 8б. Собираем словари ru.ts / ru.settings.ts
# ============================================================
# Списки импортов и спредов берём из en.ts / en.settings.ts, а не держим
# руками. На v2.0.4 en.ts раскидывает 12 модулей, а ru.ts — 3, и 743 ключа
# просто не существовали в русском словаре: не хватало ни импорта, ни спреда.
# Ручной список ко всему прочему устаревал молча — пока кто-нибудь не посмотрит
# на ошибки tsc. Теперь новый модуль апстрима подхватывается сам, стоит только
# добавить ему ru-блок в patches/ru-locale.
#
# Шаг идёт после вклейки ru-блоков: он решает, какие модули вообще включать, по
# наличию блока `ru` в их файле. На шаг раньше блоков ещё нет, и все модули
# выглядели бы непереведёнными.
echo ""
echo "[бонус] Собираем русские словари..."
if [ -f "$SCRIPT_DIR/i18n-sync-dicts.mjs" ]; then
  node "$SCRIPT_DIR/i18n-sync-dicts.mjs" packages/ui/src/lib/i18n/messages \
    || { echo "  ✗ i18n-sync-dicts.mjs не смог собрать словари"; VERIFY_FAILED=1; }
else
  echo "  ✗ не найден i18n-sync-dicts.mjs"
  VERIFY_FAILED=1
fi

# ============================================================
# 9. Нативное меню Electron (File/Edit/View и т.п.)
# ============================================================
echo ""
echo "[6/6] Локализуем нативное меню Electron..."

MENU_FILE="packages/electron/main.mjs"
if [ -f "$MENU_FILE" ]; then
  if [ -f "$SCRIPT_DIR/patch-menu.mjs" ]; then
    node "$SCRIPT_DIR/patch-menu.mjs" "$MENU_FILE"
  else
    echo "  → patch-menu.mjs не найден, пропуск"
  fi
else
  echo "  → $MENU_FILE не найден, пропуск"
fi

# Выбрасываем из русских словарей ключи, которых больше нет в апстриме.
# ru.ts типизирован как Record<I18nKey, string>, поэтому каждый оставшийся
# устаревший ключ — ошибка компиляции (TS2353). Пока чистки не было, к v2.0.4
# накопилось 164 таких ключа, и сборка падала, хотя i18n-check рапортовал
# «полное покрытие»: он проверяет пропуски и молчит про лишние.
# Запускаем ПОСЛЕ всех правок: ключ common.language.russian появляется в en.ts
# только в разделе 6, и более ранняя чистка сносила бы его из ru.ts.
# Удаляются только однострочные записи; строки-спреды (...linearPanelI18n.ru)
# не трогаются, они не являются ключами.
prune_stale() {
  local ru_file="$1" en_file="$2"
  node -e "
    const fs = require('fs');
    const ru = process.argv[1];
    const en = process.argv[2];
    // Ключ может быть в одинарных или двойных кавычках — в апстриме
    // попадаются оба варианта.
    const keyRe = /^[ \t]*['\"]([\w.]+)['\"]\s*:/;
    const enKeys = new Set();
    for (const line of fs.readFileSync(en, 'utf8').split('\n')) {
      const m = line.match(keyRe);
      if (m) enKeys.add(m[1]);
    }
    const kept = [];
    let dropped = 0;
    let keptUnsafe = 0;
    for (const line of fs.readFileSync(ru, 'utf8').split('\n')) {
      const m = line.match(keyRe);
      if (m && !enKeys.has(m[1])) {
        if (!/,\s*\$/.test(line)) { kept.push(line); keptUnsafe++; continue; }
        dropped++;
        continue;
      }
      kept.push(line);
    }
    if (dropped) fs.writeFileSync(ru, kept.join('\n'));
    const name = require('path').basename(ru);
    console.log('  ✓ ' + name + ': устаревших ключей удалено — ' + dropped);
    if (keptUnsafe) console.log('    ⚠ ' + keptUnsafe + ' запись(ей) не в одну строку — оставлены как есть');
  " "$ru_file" "$en_file"
}

echo ""
echo "[check] Полнота русской локали..."

prune_stale packages/ui/src/lib/i18n/messages/ru.ts \
            packages/ui/src/lib/i18n/messages/en.ts
prune_stale packages/ui/src/lib/i18n/messages/ru.settings.ts \
            packages/ui/src/lib/i18n/messages/en.settings.ts

if [ -f "$SCRIPT_DIR/i18n-check.mjs" ]; then
  if node "$SCRIPT_DIR/i18n-check.mjs" "packages/ui/src/lib/i18n/messages"; then
    echo "  ✓ Полное покрытие"
  else
    echo "  ⚠ Есть непереведённые ключи"
    if [ "${I18N_STRICT:-0}" = "1" ]; then
      echo "::error::В русской локали пропущены ключи (I18N_STRICT=1)"
      exit 1
    fi
    [ -n "${CI:-}" ] && echo "::warning::В русской локали есть пропуски — обновите patches/ru-locale"
  fi
else
  echo "  → i18n-check.mjs не найден, пропуск"
fi

# ============================================================
# 11. Проверка, что патчи вообще применились
# ============================================================
# Каждая правка выше — sed/perl/node -replace. Все они молчат, когда
# апстрим переставил или переименовал строку: код возвращает успех, файл
# остаётся без изменений, и сборка уезжает дальше с полуанглийским
# интерфейсом или с ошибкой компиляции. Именно так сломалось на v2.0.4,
# где 'nl' добавили в список локалей и подстановка в тип Locale перестала
# совпадать. Поэтому проверяем результат, а не факт запуска команды.
echo ""
echo "[check] Патчи применились..."

verify() {
    local desc="$1" file="$2" pattern="$3"
    if [ ! -f "$file" ]; then
        echo "  ✗ $desc — нет файла $file"
        VERIFY_FAILED=1
    elif ! grep -qE "$pattern" "$file"; then
        echo "  ✗ $desc — патч не применился ($file)"
        VERIFY_FAILED=1
    fi
}

verify "тип Locale содержит 'ru'" \
    "$RUNTIME_FILE" "^export type Locale = .*'ru'"
verify "LOCALES содержит 'ru'" \
    "$RUNTIME_FILE" "as const satisfies readonly Locale\[\]"
verify "подпись языка ru в LOCALE_LABEL_KEYS" \
    "$RUNTIME_FILE" "^  ru: 'common\.language\.russian',"
verify "нормализация ru/ru-RU/be" \
    "$RUNTIME_FILE" "normalized === 'ru'"
verify "DEFAULT_LOCALE = 'ru'" \
    "$RUNTIME_FILE" "^export const DEFAULT_LOCALE: Locale = 'ru';"
verify "store.ts импортирует словарь ru" \
    "packages/ui/src/lib/i18n/store.ts" "from './messages/ru'"
verify "store.ts отдаёт ruDict для локали по умолчанию" \
    "packages/ui/src/lib/i18n/store.ts" "ruDict"
verify "intl.ts задаёт ru: 'ru-RU'" \
    "packages/ui/src/lib/i18n/intl.ts" "^  ru: 'ru-RU',"
verify "bootstrap.ts объявляет RU_MESSAGES" \
    "packages/ui/src/lib/i18n/bootstrap.ts" "^const RU_MESSAGES"
verify "bootstrap.ts подставляет RU_MESSAGES" \
    "packages/ui/src/lib/i18n/bootstrap.ts" "^  ru: RU_MESSAGES,"
verify "en.ts перечисляет русский в выборе языка" \
    "packages/ui/src/lib/i18n/messages/en.ts" "^  'common\.language\.russian':"
verify "словарь ru.ts на месте" \
    "packages/ui/src/lib/i18n/messages/ru.ts" "dict"
verify "словарь ru.settings.ts на месте" \
    "packages/ui/src/lib/i18n/messages/ru.settings.ts" "dict"

# LOCALES: 'ru' должен быть не просто в типе, но и в самом массиве,
# иначе русский не появится в списке выбора языка.
if [ -f "$RUNTIME_FILE" ] \
   && ! grep -A2 "export const LOCALES" "$RUNTIME_FILE" | grep -q "'ru'"; then
    echo "  ✗ LOCALES не содержит 'ru' — русский не будет в списке языков"
    VERIFY_FAILED=1
fi

if [ "$VERIFY_FAILED" != "0" ]; then
    echo ""
    echo "::error::Русская локаль подключена не полностью — сборка остановлена."
    echo "::error::Обычно это значит, что апстрим изменил структуру файлов."
    echo "::error::Смотрите список пунктов выше: каждый «✗» — не применившийся патч."
    exit 1
fi
echo "  ✓ все подключения на месте"

# ============================================================
# ГОТОВО
# ============================================================
echo ""
echo "============================================="
echo "=== РУССКАЯ ЛОКАЛЬ УСПЕШНО ДОБАВЛЕНА! ==="
echo "============================================="
