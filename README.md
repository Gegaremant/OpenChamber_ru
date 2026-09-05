# OpenChamber_ru

> **Автоматическая сборка русифицированной версии [OpenChamber](https://github.com/openchamber/openchamber)**

Этот репозиторий содержит автоматический pipeline, который при каждом новом релизе оригинального [OpenChamber](https://github.com/openchamber/openchamber) клонирует его, добавляет русский язык и собирает готовые приложения для всех платформ.

**Оригинальный проект:** [github.com/openchamber/openchamber](https://github.com/openchamber/openchamber)

---

## Загрузка

Скачайте последний релиз со страницы [Releases](https://github.com/Gegaremant/OpenChamber_ru/releases/latest):

| Платформа | Файл |
|-----------|------|
| **Linux x86_64** | `OpenChamber_ru-<версия>-linux-x86_64.AppImage` |
| **Windows x64** | `OpenChamber_ru-<версия>-win-x64.exe` |
| **macOS** | `OpenChamber_ru-<версия>-mac-x64.dmg` / `.zip` |
| **Android** | `OpenChamber_ru-<версия>-android.apk` |

> Все артефакты именуются единообразно с префиксом `OpenChamber_ru-`.

## Что это?

**OpenChamber** — это open-source рабочее пространство для запуска, контроля и проверки AI-кодирования на десктопе, в браузере, редакторе и на мобильном.

**OpenChamber_ru** — это автоматическая сборка с добавленным русским языком. Процесс сборки:

1. Workflow проверяет наличие нового релиза оригинального OpenChamber
2. Клонирует оригинал нужной версии
3. Добавляет файлы русской локали (`ru.ts`, `ru.settings.ts`)
4. Модифицирует i18n инфраструктуру для поддержки русского языка
5. Собирает приложения для Linux, Windows, macOS и Android
6. Публикует релиз с готовыми артефактами

## Язык

Русский язык установлен **по умолчанию** — при первом запуске приложение открывается на русском.

Если нужно сменить язык:

1. Откройте OpenChamber
2. Перейдите в **Settings** (Настройки)
3. Найдите раздел **Language** (Язык)
4. Выберите нужный язык

> Примечание: если на устройстве ранее уже был выбран другой язык, он сохранится.
> Чтобы вернуть русский по умолчанию — очистите данные приложения или переключите язык в настройках.

## Быстрый старт

### Linux (Debian / Ubuntu)

Самый простой способ — установить через скрипт. Он ставит ярлык в меню приложений,
иконку и команду `openchamber-ru` для запуска из терминала:

```bash
# 1. Скачайте OpenChamber_ru-<версия>-linux-x86_64.AppImage
# 2. Из каталога с файлом выполните:
chmod +x install-linux.sh
./install-linux.sh
```

После этого запускайте из меню приложений (ярлык **OpenChamber_ru**) или командой:

```bash
openchamber-ru
```

#### Запуск без установки

```bash
chmod +x OpenChamber_ru-*.AppImage
./OpenChamber_ru-*.AppImage
```

#### Если приложение не открывается (пустой DISPLAY)

На серверах и в RDP-сессиях (xrdp) переменная `DISPLAY` / `XAUTHORITY` часто
не задана. Запустите с явным указанием:

```bash
export DISPLAY=:10.0                 # укажите ваш дисплей (:0 — локальный рабочий стол)
export XAUTHORITY="$HOME/.Xauthority"
./OpenChamber_ru-*.AppImage --no-sandbox
```

Определить активный дисплей можно так:

```bash
echo "$DISPLAY"                      # если пусто — найдём вручную
for d in :0 :10 :11; do DISPLAY=$d xdpyinfo >/dev/null 2>&1 && echo "рабочий дисплей: $d"; done
```

> Установочный скрипт `install-linux.sh` автоматически определяет корректные
> `DISPLAY`/`XAUTHORITY` (работает и на обычном рабочем столе, и на xrdp).

### Windows

Запустите `OpenChamber_ru-<версия>-win-x64.exe` (установщик NSIS).

### macOS

Откройте `OpenChamber_ru-<версия>-mac-x64.dmg` и перетащите OpenChamber в Applications.

### Android

Скачайте `OpenChamber_ru-<версия>-android.apk` и установите его на устройство.

## Возможности OpenChamber

- **Цели сессий** — ставьте задачи агенту и следите за их выполнением
- **Мульти-запуск** — запускайте одну задачу на нескольких моделях одновременно
- **Обзор изменений** — AI-проводник по большому diff
- **Предпросмотр** — откройте приложение рядом с диалогом
- **GitHub интеграция** — начинайте сессии из issue и pull request
- **Кроссплатформенность** — десктоп, веб, VS Code, iOS, Android
- **Приватный доступ** — подключение через QR-код без открытия портов
- **Планирование** — запускайте задачи по расписанию

## Сборка из исходников

```bash
git clone https://github.com/Gegaremant/OpenChamber_ru.git
cd OpenChamber_ru
bash patches/ru-locale/apply-ru-locale.sh main .
bun install
cd packages/electron
bun run build:web-assets
bun run prepare:opencode-cli
bun run bundle:main
bun run rebuild:native
bunx electron-builder --linux --x64 --publish=never
```

## Благодарности

- [OpenChamber](https://github.com/openchamber/openchamber) — оригинальный проект
- [OpenCode](https://opencode.ai) — движок для AI-агентов

## Лицензия

MIT (как и оригинальный проект)
