#!/bin/bash
#
# OpenChamber_ru — установка / запуск для Debian / Ubuntu
#
# Скрипт сам скачивает последнюю версию OpenChamber_ru с GitHub Releases
# и устанавливает её в систему:
#   * AppImage -> ~/.local/share/OpenChamber_ru/
#   * иконка   -> ~/.local/share/icons/hicolor/512x512/apps/
#   * ярлык    -> ~/.local/share/applications/OpenChamber_ru.desktop (меню приложений)
#   * команда  -> openchamber-ru (запуск из терминала)
#
# Автоматически определяет DISPLAY / XAUTHORITY (работает и на обычном
# рабочем столе, и в RDP/xrdp-сессиях).
#
# Использование:
#   ./install-linux.sh                 # скачать последний релиз и установить
#   ./install-linux.sh install         # то же самое
#   ./install-linux.sh run             # скачать последний релиз и сразу запустить (без установки)
#   ./install-linux.sh install ./file.AppImage   # установить уже скачанный файл
#   ./install-linux.sh run    ./file.AppImage   # запустить уже скачанный файл
#   ./install-linux.sh uninstall       # удалить установленную копию
#
set -euo pipefail

APP_NAME="OpenChamber_ru"
BIN_NAME="openchamber-ru"
REPO="Gegaremant/OpenChamber_ru"
DOWNLOAD_DIR="$HOME/.cache/openchamber-ru"

log()  { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warning]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- Собираем аргументы ----------
MODE="install"
LOCAL_APPIMAGE=""

for arg in "$@"; do
  case "$arg" in
    install|run|uninstall) MODE="$arg" ;;
    *) LOCAL_APPIMAGE="$arg" ;;
  esac
done

install_deps() {
  step "1/4. Скачивание OpenChamber_ru"
  command -v curl >/dev/null 2>&1 || die \
    "Не найден curl. Установите: sudo apt install -y curl"

  if [[ -n "$LOCAL_APPIMAGE" ]]; then
    [[ -f "$LOCAL_APPIMAGE" ]] || die "Файл не найден: $LOCAL_APPIMAGE"
    APPIMAGE="$LOCAL_APPIMAGE"
    log "Использую локальный файл: $APPIMAGE"
  else
    mkdir -p "$DOWNLOAD_DIR"
    log "Получаю информацию о последнем релизе..."

    # Узнаём тег последнего релиза через redirect (HTML, без API-лимитов)
    TAG=$(curl -fsS -o /dev/null -w '%{redirect_url}' \
      "https://github.com/$REPO/releases/latest" 2>/dev/null \
      | sed -n 's#.*/releases/tag/\(v[^/]*\).*#\1#p')
    [[ -n "$TAG" ]] || die "Не удалось определить последний релиз."
    VERSION="${TAG#v}"
    log "Последняя версия: v$VERSION"

    # Имя AppImage из списка файлов релиза (HTML-эндпоинт expanded_assets)
    ASSET_NAME=$(curl -fsSL \
      "https://github.com/$REPO/releases/expanded_assets/$TAG" 2>/dev/null \
      | grep -oE 'OpenChamber_ru-[^"<]*linux-x86_64\.AppImage' | head -1)
    [[ -n "$ASSET_NAME" ]] || die "Не найден AppImage в последнем релизе."

    APPIMAGE="$DOWNLOAD_DIR/$ASSET_NAME"
    URL="https://github.com/$REPO/releases/latest/download/$ASSET_NAME"

    if [[ -f "$APPIMAGE" && -s "$APPIMAGE" ]]; then
      log "Последняя версия уже скачана (v$VERSION)"
    else
      log "Скачиваю $ASSET_NAME (v$VERSION)..."
      curl -fL --progress-bar -o "$APPIMAGE" "$URL" || die \
        "Ошибка скачивания: $URL"
    fi
    log "Готово: $APPIMAGE"
  fi
}

prepare_appimage() {
  install_deps
  chmod +x "$APPIMAGE"
}

# ---------- Проверка зависимостей ----------
check_deps() {
  step "2/4. Проверка зависимостей"
  local deps_pkg=()
  command -v fusermount >/dev/null 2>&1 || command -v fusermount3 >/dev/null 2>&1 \
    || deps_pkg+=("libfuse2t64 fuse")
  [[ -e /dev/fuse || -r /dev/fuse ]] || deps_pkg+=("fuse")
  if [[ ${#deps_pkg[@]} -gt 0 ]]; then
    warn "Нужен FUSE для запуска AppImage: ${deps_pkg[*]}"
    warn "   sudo apt update && sudo apt install -y ${deps_pkg[*]}"
  fi
  for lib in libnss3 libgtk-3-0t64 libasound2t64; do
    dpkg -s "$lib" >/dev/null 2>&1 || warn "Рекомендуется установить: $lib"
  done
}

# ---------- Определяем дисплей ----------
detect_display() {
  if [[ -z "${DISPLAY:-}" ]]; then
    for d in :0 :1 :10 :11; do
      if command -v xdpyinfo >/dev/null 2>&1 \
         && DISPLAY="$d" xdpyinfo >/dev/null 2>&1; then
        export DISPLAY="$d"
        log "Дисплей выбран автоматически: $d"
        break
      fi
    done
  fi
  [[ -z "${XAUTHORITY:-}" && -f "$HOME/.Xauthority" ]] \
    && export XAUTHORITY="$HOME/.Xauthority"
  log "DISPLAY=${DISPLAY:-<пусто>}  XAUTHORITY=${XAUTHORITY:-<по умолчанию>}"
}

# ---------- Установка ----------
do_install() {
  prepare_appimage
  check_deps
  detect_display

  step "3/4. Установка в систему"
  INSTALL_DIR="$HOME/.local/share/OpenChamber_ru"
  DESKTOP_DIR="$HOME/.local/share/applications"
  ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR" "$DESKTOP_DIR" "$ICON_DIR" "$BIN_DIR"

  cp "$APPIMAGE" "$INSTALL_DIR/$APP_NAME.AppImage"
  chmod +x "$INSTALL_DIR/$APP_NAME.AppImage"
  log "Установлен: $INSTALL_DIR/$APP_NAME.AppImage"

  # Иконка
  EXTRACT_DIR=$(mktemp -d)
  ICON_SRC=""
  if (cd "$EXTRACT_DIR" && "$INSTALL_DIR/$APP_NAME.AppImage" --appimage-extract \
        >"$EXTRACT_DIR/runtime.log" 2>&1); then
    [[ -f "$EXTRACT_DIR/squashfs-root/openchamber.png" ]] \
      && ICON_SRC="$EXTRACT_DIR/squashfs-root/openchamber.png"
    [[ -z "$ICON_SRC" && -f "$EXTRACT_DIR/squashfs-root/usr/share/icons/hicolor/512x512/apps/openchamber.png" ]] \
      && ICON_SRC="$EXTRACT_DIR/squashfs-root/usr/share/icons/hicolor/512x512/apps/openchamber.png"
  fi
  if [[ -n "$ICON_SRC" ]]; then
    cp "$ICON_SRC" "$ICON_DIR/$APP_NAME.png"
    log "Иконка: $ICON_DIR/$APP_NAME.png"
  fi
  rm -rf "$EXTRACT_DIR"

  # Ярлык в меню
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
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
  log "Ярлык в меню: $DESKTOP_DIR/$APP_NAME.desktop"

  # Команда openchamber-ru
  cat >"$BIN_DIR/$BIN_NAME" <<EOF
#!/bin/bash
exec "$INSTALL_DIR/$APP_NAME.AppImage" --no-sandbox "\$@"
EOF
  chmod +x "$BIN_DIR/$BIN_NAME"
  log "Команда: $BIN_NAME"

  step "4/4. Готово"
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    warn "$BIN_DIR нет в PATH."
    echo "    Добавьте в ~/.bashrc:  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo "    Затем: source ~/.bashrc"
  fi
  echo ""
  echo "  Запуск из меню приложений:  OpenChamber_ru"
  echo "  Запуск из терминала:        $BIN_NAME"
  echo "  Или прямо сейчас установленное:"
  echo "     $INSTALL_DIR/$APP_NAME.AppImage"
}

# ---------- Запуск без установки ----------
do_run() {
  prepare_appimage
  check_deps
  detect_display
  log "Запускаю: $APPIMAGE"
  exec "$APPIMAGE" --no-sandbox "$@"
}

# ---------- Удаление ----------
do_uninstall() {
  INSTALL_DIR="$HOME/.local/share/OpenChamber_ru"
  DESKTOP_DIR="$HOME/.local/share/applications"
  ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
  BIN_DIR="$HOME/.local/bin"
  rm -f "$DESKTOP_DIR/$APP_NAME.desktop"
  rm -f "$ICON_DIR/$APP_NAME.png"
  rm -f "$BIN_DIR/$BIN_NAME"
  rm -rf "$INSTALL_DIR"
  log "OpenChamber_ru удалён."
}

case "$MODE" in
  run)       do_run ;;
  uninstall) do_uninstall ;;
  *)         do_install ;;
esac
