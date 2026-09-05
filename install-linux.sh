#!/bin/bash
#
# OpenChamber_ru — установка для Debian / Ubuntu
#
# Устанавливает OpenChamber_ru AppImage в систему:
#   * копирует AppImage, иконку и .desktop-файл в ~/.local/share
#   * создаёт ярлык в меню приложений
#   * корректно определяет DISPLAY / XAUTHORITY (работает и на xrdp)
#   * добавляет команду `openchamber-ru` для запуска из терминала
#
# Использование:
#   ./install-linux.sh [путь-к-AppImage]
#
# Если путь не указан, скрипт ищет OpenChamber_ru-*.AppImage
# в текущем каталоге, ~/Загрузки и ~/Downloads.
#
set -euo pipefail

APP_NAME="OpenChamber_ru"
BIN_NAME="openchamber-ru"

log()  { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warning]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. Находим AppImage ----------
APPIMAGE="${1:-}"

if [[ -z "$APPIMAGE" ]]; then
  for dir in "$PWD" "$HOME/Загрузки" "$HOME/Downloads"; do
    if compgen -G "$dir/OpenChamber_ru-*.AppImage" >/dev/null; then
      APPIMAGE=$(compgen -G "$dir/OpenChamber_ru-*.AppImage" | head -1)
      break
    fi
  done
fi

[[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]] && die \
  "AppImage не найден. Укажите путь: ./install-linux.sh /путь/OpenChamber_ru-*.AppImage"

log "Найден AppImage: $APPIMAGE"

# ---------- 2. Проверяем зависимости ----------
dep_missing=()
command -v fusermount >/dev/null 2>&1 || command -v fusermount3 >/dev/null 2>&1 || dep_missing+=("fuse (libfuse2)")
[[ -e /dev/fuse ]]                || [[ -r /dev/fuse ]] || dep_missing+=("/dev/fuse")
command -v xmllint >/dev/null 2>&1 || true

if [[ ${#dep_missing[@]} -gt 0 ]]; then
  warn "Возможно, отсутствуют зависимости: ${dep_missing[*]}"
  warn "Установите их, например:"
  warn "    sudo apt update && sudo apt install -y libfuse2t64 fuse"
fi

# Проверяем базовые X-клиентские библиотеки, нужные Electron
for lib in libnss3 libatk-bridge2.0-0t64 libgtk-3-0t64 libasound2t64; do
  if ! dpkg -s "$lib" >/dev/null 2>&1; then
    warn "Рекомендуется установить: $lib"
  fi
done

# ---------- 3. Определяем DISPLAY / XAUTHORITY ----------
# Обычный рабочий стол:
#   DISPLAY уже задан (например :0), XAUTHORITY по умолчанию ~/.Xauthority.
# Сессия xrdp:
#   DISPLAY=:10, но часто XAUTHORITY не выставлен явно.
if [[ -z "${DISPLAY:-}" ]]; then
  # Пытаемся найти активный X-дисплей, принадлежащий текущему пользователю
  for d in :0 :1 :10 :11; do
    if command -v xdpyinfo >/dev/null 2>&1 \
       && DISPLAY="$d" xdpyinfo >/dev/null 2>&1; then
      export DISPLAY="$d"
      log "DISPLAY не задан — выбран автоматически: $d"
      break
    fi
  done
fi

if [[ -z "${XAUTHORITY:-}" && -f "$HOME/.Xauthority" ]]; then
  export XAUTHORITY="$HOME/.Xauthority"
fi

log "DISPLAY=${DISPLAY:-<пусто>}  XAUTHORITY=${XAUTHORITY:-<по умолчанию>}"

# ---------- 4. Устанавливаем файлы ----------
INSTALL_DIR="$HOME/.local/share/OpenChamber_ru"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
BIN_DIR="$HOME/.local/bin"

mkdir -p "$INSTALL_DIR" "$DESKTOP_DIR" "$ICON_DIR" "$BIN_DIR"

# Настраиваем и делаем исполняемым AppImage
cp "$APPIMAGE" "$INSTALL_DIR/$APP_NAME.AppImage"
chmod +x "$INSTALL_DIR/$APP_NAME.AppImage"
log "Установлен: $INSTALL_DIR/$APP_NAME.AppImage"

# Извлекаем иконку из AppImage (через --appimage-extract, не требует FUSE)
EXTRACT_DIR=$(mktemp -d)
ICON_SRC=""
if (cd "$EXTRACT_DIR" && "$INSTALL_DIR/$APP_NAME.AppImage" --appimage-extract \
      >"$EXTRACT_DIR/runtime.log" 2>&1); then
  if [[ -f "$EXTRACT_DIR/squashfs-root/openchamber.png" ]]; then
    ICON_SRC="$EXTRACT_DIR/squashfs-root/openchamber.png"
  elif [[ -f "$EXTRACT_DIR/squashfs-root/usr/share/icons/hicolor/512x512/apps/openchamber.png" ]]; then
    ICON_SRC="$EXTRACT_DIR/squashfs-root/usr/share/icons/hicolor/512x512/apps/openchamber.png"
  fi
fi

if [[ -n "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$ICON_DIR/$APP_NAME.png"
  log "Установлена иконка: $ICON_DIR/$APP_NAME.png"
elif command -v convert >/dev/null 2>&1; then
  convert -size 512x512 xc:none -fill '#4f46e5' \
    -gravity center -pointsize 380 -annotate 0 'O' "$ICON_DIR/$APP_NAME.png" 2>/dev/null \
    && log "Сгенерирована простая иконка" \
    || warn "Не удалось извлечь иконку. Ярлык использует стандартную."
else
  warn "Не удалось извлечь иконку. Ярлык подключим без кастомной иконки."
fi
rm -rf "$EXTRACT_DIR"

# ---------- 5. Создаём .desktop-файл ----------
cat >"$DESKTOP_DIR/$APP_NAME.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=OpenChamber_ru
Comment=Автоматическая сборка русифицированного OpenChamber
Exec="$INSTALL_DIR/$APP_NAME.AppImage" --no-sandbox %U
Icon=$ICON_DIR/$APP_NAME.png
Terminal=false
Categories=Development;Utility;
StartupWMClass=openchamber
MimeType=x-scheme-handler/openchamber;
EOF

# Обновляем кеш десктоп-файлов (если доступен)
command -v update-desktop-database >/dev/null 2>&1 \
  && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
log "Создан ярлык в меню: $DESKTOP_DIR/$APP_NAME.desktop"

# ---------- 6. Добавляем команду запуска из терминала ----------
if [[ -n "$BIN_DIR" ]]; then
  cat >"$BIN_DIR/$BIN_NAME" <<EOF
#!/bin/bash
exec "$INSTALL_DIR/$APP_NAME.AppImage" --no-sandbox "\$@"
EOF
  chmod +x "$BIN_DIR/$BIN_NAME"
  log "Добавлена команда: $BIN_NAME (требуется $BIN_DIR в PATH)"
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    warn "$BIN_DIR нет в PATH. Добавьте строку в ~/.bashrc:"
    warn "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

cat <<EOF

================================================================
  Готово! OpenChamber_ru установлен.

  Запуск из меню приложений:  OpenChamber_ru
  Запуск из терминала:       $BIN_NAME

  Файлы:
    $INSTALL_DIR/$APP_NAME.AppImage
    $DESKTOP_DIR/$APP_NAME.desktop
    $ICON_DIR/$APP_NAME.png
================================================================
EOF
