#!/bin/bash
set -euo pipefail

# ============================================================
# OpenChamber RU — скрипт добавления русской локали
# Клонирует оригинальный OpenChamber и добавляет русский язык
# Использование: ./apply-ru-locale.sh [version]
#   version — тег релиза (например 1.22.0) или опустите для main
# ============================================================

VERSION="${1:-main}"
REPO="https://github.com/openchamber/openchamber.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${2:-/tmp/openchamber-ru-build}"

echo "=== OpenChamber RU — добавление русской локали ==="
echo "Версия: $VERSION"
echo "Директория сборки: $BUILD_DIR"

# --- Клонируем ---
if [ -d "$BUILD_DIR/.git" ]; then
    echo "Директория уже существует и является git-репозиторием, пропускаем клонирование."
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

# Заменяем тип Locale — добавляем 'ru' после 'uk'
sed -i "s/export type Locale = 'en' | 'de' | 'fr' | 'zh-CN' | 'zh-TW' | 'uk' | 'es'/export type Locale = 'en' | 'de' | 'fr' | 'zh-CN' | 'zh-TW' | 'uk' | 'ru' | 'es'/" packages/ui/src/lib/i18n/runtime.ts

# Заменяем массив LOCALES — добавляем 'ru' после 'uk'
sed -i "s/\['en', 'de', 'fr', 'zh-CN', 'zh-TW', 'uk', 'es'/['en', 'de', 'fr', 'zh-CN', 'zh-TW', 'uk', 'ru', 'es'/" packages/ui/src/lib/i18n/runtime.ts

# Добавляем 'common.language.russian' в тип LOCALE_LABEL_KEYS
sed -i "s/'common.language.ukrainian' | 'common.language.spanish'/'common.language.ukrainian' | 'common.language.russian' | 'common.language.spanish'/" packages/ui/src/lib/i18n/runtime.ts

# Добавляем ru: 'common.language.russian' после uk в LOCALE_LABEL_KEYS
sed -i "/uk: 'common.language.ukrainian',/a\\  ru: 'common.language.russian'," packages/ui/src/lib/i18n/runtime.ts

# Добавляем нормализацию ru/be после uk блока
sed -i "/return 'uk';/a\\  }\\n  if (normalized === 'ru' || normalized.startsWith('ru-') || normalized === 'be' || normalized.startsWith('be-')) {\\n    return 'ru';" packages/ui/src/lib/i18n/runtime.ts

echo "  ✓ runtime.ts обновлён"

# ============================================================
# 3. store.ts — добавляем динамический импорт для 'ru'
# ============================================================
echo ""
echo "[3/5] Модифицируем store.ts..."

# Добавляем ветку для ru после uk
sed -i "/locale === 'uk'/,/\? await import('.\/messages\/uk')/{
  /? await import('.\/messages\/uk')/a\\
            : locale === 'ru'\\
              ? await import('./messages/ru') as { dict: I18nDictionary }
}" packages/ui/src/lib/i18n/store.ts

echo "  ✓ store.ts обновлён"

# ============================================================
# 4. intl.ts — добавляем ru: 'ru-RU'
# ============================================================
echo ""
echo "[4/5] Модифицируем intl.ts..."

sed -i "/uk: 'uk-UA',/a\\  ru: 'ru-RU'," packages/ui/src/lib/i18n/intl.ts

echo "  ✓ intl.ts обновлён"

# ============================================================
# 5. bootstrap.ts — добавляем RU_MESSAGES
# ============================================================
echo ""
echo "[5/5] Модифицируем bootstrap.ts..."

# Вставляем блок RU_MESSAGES после UK_MESSAGES
cat >> /tmp/ru_messages_block.txt << 'RUMESSAGES'

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
  startingDevServer: (hostLabel) => `Запуск dev-сервера webview (${hostLabel})...`,
  waitingDevServer: (hostLabel, attempt) => `Ожидание dev-сервера webview (${hostLabel})... попытка ${attempt}`,
  loadingData: (providersText, agentsText) => `Загрузка данных (${providersText}, ${agentsText})…`,
};
RUMESSAGES

# Используем node.js для надёжной вставки RU_MESSAGES в bootstrap.ts
node -e "
  const fs = require('fs');
  let content = fs.readFileSync('packages/ui/src/lib/i18n/bootstrap.ts', 'utf8');

  // Вставляем RU_MESSAGES перед ES_MESSAGES
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

  // Вставляем перед const ES_MESSAGES
  content = content.replace(/const ES_MESSAGES:/, ruBlock + 'const ES_MESSAGES:');

  // Добавляем ru: RU_MESSAGES в BOOTSTRAP_MESSAGES
  content = content.replace(/uk: UK_MESSAGES,/, 'uk: UK_MESSAGES,\\n  ru: RU_MESSAGES,');

  fs.writeFileSync('packages/ui/src/lib/i18n/bootstrap.ts', content);
  console.log('  ✓ bootstrap.ts обновлён через node.js');
"

# ============================================================
# 6. Добавляем 'common.language.russian' во все языковые файлы
# ============================================================
echo ""
echo "[бонус] Добавляем 'common.language.russian' во все локали..."

# Список файлов и их переводов "Russian"
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
    # Добавляем строку после common.language.turkish
    line="${RUSSIAN_NAMES[$file]}"
    sed -i "/common.language.turkish/a\\
$line" "$filepath"
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
  sed -i "/uk: 'Ukrainian',/a\\  ru: 'Russian'," "$LANG_FILE"
  echo "  ✓ languages.js"
fi

# ============================================================
# 8. Интеграционные i18n файлы — добавляем ru блоки
# ============================================================
echo ""
echo "[бонус] Добавляем ru блоки в интеграционные i18n файлы..."

# Для каждого интеграционного файла добавляем ru: { ... } блок перед uk:
# (Используем node.js для надёжной вставки)

INTEGRATION_FILES=(
  "packages/ui/src/lib/i18n/messages/linear-integration.i18n.ts"
  "packages/ui/src/lib/i18n/messages/linear-issue-picker.i18n.ts"
  "packages/ui/src/lib/i18n/messages/linear-panel.i18n.ts"
  "packages/ui/src/lib/i18n/messages/third-party-integrations.i18n.ts"
)

# Копируем готовые ru-блоки из оригинального билда
ORIGINAL_RU_BUILD="${SCRIPT_DIR}/../../packages/ui/src/lib/i18n/messages"

for intfile in "${INTEGRATION_FILES[@]}"; do
  if [ -f "$intfile" ]; then
    filename=$(basename "$intfile")
    orig_file="$ORIGINAL_RU_BUILD/$filename"
    
    # Проверяем есть ли ru блок в оригинальном файле
    if [ -f "$orig_file" ] && grep -q "ru:" "$orig_file"; then
      # Извлекаем ru блок из оригинального файла
      node -e "
        const fs = require('fs');
        const content = fs.readFileSync('$orig_file', 'utf8');
        const match = content.match(/(\s*ru:\s*\{[\s\S]*?\n  \},)\n/);
        if (match) {
          const ruBlock = match[1];
          let target = fs.readFileSync('$intfile', 'utf8');
          // Вставляем ru блок перед uk:
          if (!target.includes('ru:')) {
            target = target.replace(/(\n\s*uk:\s*\{)/, '\n' + ruBlock + '\$1');
            fs.writeFileSync('$intfile', target);
            console.log('  ✓ ' + '$filename' + ' (ru блок добавлен)');
          } else {
            console.log('  → ' + '$filename' + ' (ru блок уже есть)');
          }
        } else {
          console.log('  ⚠ ' + '$filename' + ' (ru блок не найден в оригинале)');
        }
      " 2>/dev/null || echo "  ⚠ $filename (ошибка при вставке ru блока)"
    else
      echo "  → $filename (пропущен — нет ru блока в оригинале)"
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
echo ""
echo "Директория: $BUILD_DIR"
echo ""
echo "Для сборки выполните:"
echo "  cd $BUILD_DIR"
echo "  bun install"
echo ""
echo "Linux AppImage:"
echo "  cd packages/electron"
echo "  bun run build:web-assets && bun run prepare:opencode-cli && bun run bundle:main && bun run rebuild:native"
echo "  bunx electron-builder --linux --x64 --publish=never"
echo ""
echo "Windows (из Linux, нужен wine):"
echo "  bunx electron-builder --win nsis --x64 --publish=never"
echo ""
echo "macOS:"
echo "  bunx electron-builder --mac --x64 --publish=never"
echo ""
echo "Android:"
echo "  cd ../mobile && bun run build:android:debug"
