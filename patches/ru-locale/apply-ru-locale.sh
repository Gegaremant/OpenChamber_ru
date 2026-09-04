#!/bin/bash
set -euo pipefail

# ============================================================
# OpenChamber RU — скрипт добавления русской локали
#
# Режим 1 (standalone): ./apply-ru-locale.sh [version] [build_dir]
#   Клонирует оригинальный OpenChamber и добавляет русский язык
#
# Режим 2 (in-workflow): apply-ru-locale.sh <version> <existing_dir>
#   Если <existing_dir> существует и является git-репозиторием,
#   клонирование пропускается.
# ============================================================

VERSION="${1:-main}"
REPO="https://github.com/openchamber/openchamber.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${2:-/tmp/openchamber-ru-build}"

echo "=== OpenChamber RU — добавление русской локали ==="
echo "Версия: $VERSION"

# --- Клонируем (только если директория не существует) ---
if [ -d "$BUILD_DIR/.git" ]; then
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

perl -0pi -e "s/export type Locale = 'en' \| 'de' \| 'fr' \| 'zh-CN' \| 'zh-TW' \| 'uk' \| 'es'/export type Locale = 'en' \| 'de' \| 'fr' \| 'zh-CN' \| 'zh-TW' \| 'uk' \| 'ru' \| 'es'/" packages/ui/src/lib/i18n/runtime.ts
perl -0pi -e "s/\['en', 'de', 'fr', 'zh-CN', 'zh-TW', 'uk', 'es'/['en', 'de', 'fr', 'zh-CN', 'zh-TW', 'uk', 'ru', 'es'/" packages/ui/src/lib/i18n/runtime.ts
perl -0pi -e "s/'common\.language\.ukrainian' \| 'common\.language\.spanish'/'common.language.ukrainian' \| 'common.language.russian' \| 'common.language.spanish'/" packages/ui/src/lib/i18n/runtime.ts
perl -0pi -e "s/(uk: 'common\.language\.ukrainian',)/\$1\n  ru: 'common.language.russian',/" packages/ui/src/lib/i18n/runtime.ts
perl -0pi -e "s/return 'uk';/return 'uk';\n  }\n  if (normalized === 'ru' || normalized.startsWith('ru-') || normalized === 'be' || normalized.startsWith('be-')) {\n    return 'ru';/s" packages/ui/src/lib/i18n/runtime.ts
perl -0pi -e "s/export const DEFAULT_LOCALE: Locale = 'en';/export const DEFAULT_LOCALE: Locale = 'ru';/" packages/ui/src/lib/i18n/runtime.ts

echo "  ✓ runtime.ts обновлён (RU — язык по умолчанию)"

# ============================================================
# 3. store.ts — добавляем динамический импорт для 'ru'
# ============================================================
echo ""
echo "[3/5] Модифицируем store.ts..."

perl -0pi -e "s/(\? await import\('\.\/messages\/uk'\) as \{ dict: I18nDictionary \}\n)/\$1            : locale === 'ru'\n              ? await import('.\/messages\/ru') as { dict: I18nDictionary }\n/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/import \{ dict as enDict, type I18nKey \} from '\.\/messages\/en';/import { dict as enDict, type I18nKey } from '.\/messages\/en';\nimport { dict as ruDict } from '.\/messages\/ru';/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/\[\[DEFAULT_LOCALE, enDict\]\]/[[DEFAULT_LOCALE, ruDict]]/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/dictionaries\.set\(DEFAULT_LOCALE, enDict\);/dictionaries.set(DEFAULT_LOCALE, ruDict);/" packages/ui/src/lib/i18n/store.ts
perl -0pi -e "s/(  locale: DEFAULT_LOCALE,\n  )dictionary: enDict,/\$1dictionary: ruDict,/" packages/ui/src/lib/i18n/store.ts

echo "  ✓ store.ts обновлён"

# ============================================================
# 4. intl.ts — добавляем ru: 'ru-RU'
# ============================================================
echo ""
echo "[4/5] Модифицируем intl.ts..."

perl -0pi -e "s/(uk: 'uk-UA',)/\$1\n  ru: 'ru-RU',/" packages/ui/src/lib/i18n/intl.ts

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

  content = content.replace(/const ES_MESSAGES:/, ruBlock + 'const ES_MESSAGES:');
  content = content.replace(/uk: UK_MESSAGES,/, 'uk: UK_MESSAGES,\\n  ru: RU_MESSAGES,');

  fs.writeFileSync('packages/ui/src/lib/i18n/bootstrap.ts', content);
  console.log('  ✓ bootstrap.ts обновлён');
"

# ============================================================
# 6. Добавляем 'common.language.russian' во все языковые файлы
# ============================================================
echo ""
echo "[бонус] Добавляем 'common.language.russian' во все локали..."

declare -A RUSSIAN_NAMES=(
  ["en.ts"]="'common.language.russian': 'Russian',"
  ["de.ts"]="'common.language.russian': 'Russisch',"
  ["es.ts"]="'common.language.russian': 'Ruso',"
  ["fr.ts"]="'common.language.russian': 'Russe',"
  ["ja.ts"]="'common.language.russian': 'ロシア語',"
  ["ko.ts"]="'common.language.russian': '러시아어',"
  ["pl.ts"]="'common.language.russian': 'Rosyjski',"
  ["pt-BR.ts"]="'common.language.russian': 'Russo',"
  ["tr.ts"]="'common.language.russian': 'Rusça',"
  ["uk.ts"]="'common.language.russian': 'Російська',"
  ["zh-CN.ts"]="'common.language.russian': '俄语',"
  ["zh-TW.ts"]="'common.language.russian': '俄語',"
)

for file in "${!RUSSIAN_NAMES[@]}"; do
  filepath="packages/ui/src/lib/i18n/messages/$file"
  if [ -f "$filepath" ]; then
    line="${RUSSIAN_NAMES[$file]}"
    perl -0pi -e "s/(common\.language\.turkish:.*\n)/\$1$line\n/" "$filepath"
    echo "  ✓ $file"
  fi
done

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

INTEGRATION_FILES=(
  "packages/ui/src/lib/i18n/messages/linear-integration.i18n.ts"
  "packages/ui/src/lib/i18n/messages/linear-issue-picker.i18n.ts"
  "packages/ui/src/lib/i18n/messages/linear-panel.i18n.ts"
  "packages/ui/src/lib/i18n/messages/third-party-integrations.i18n.ts"
)

# Полные версии интеграционных файлов с ru блоками лежат в patches/ru-locale
for intfile in "${INTEGRATION_FILES[@]}"; do
  if [ -f "$intfile" ]; then
    filename=$(basename "$intfile")
    patched_file="$SCRIPT_DIR/$filename"
    if [ -f "$patched_file" ] && grep -q "ru:" "$patched_file"; then
      cp "$patched_file" "$intfile"
      echo "  ✓ $filename (полная версия с ru блоком)"
    else
      echo "  → $filename (патч не найден)"
    fi
  fi
done

# ============================================================
# ГОТОВО
# ============================================================
echo ""
echo "============================================="
echo "=== РУССКАЯ ЛОКАЛЬ УСПЕШНО ДОБАВЛЕНА! ==="
echo "============================================="
