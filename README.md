# OpenChamber_ru

> **Автоматическая сборка русифицированной версии [OpenChamber](https://github.com/openchamber/openchamber)**

Этот репозиторий содержит автоматический pipeline, который при каждом новом релизе оригинального [OpenChamber](https://github.com/openchamber/openchamber) клонирует его, добавляет русский язык и собирает готовые приложения для всех платформ.

**Оригинальный проект:** [github.com/openchamber/openchamber](https://github.com/openchamber/openchamber)

---

## Загрузка

Скачайте последний релиз со страницы [Releases](https://github.com/Gegaremant/OpenChamber_ru/releases/latest):

| Платформа | Формат |
|-----------|--------|
| **Linux x86_64** | AppImage |
| **Windows x64** | NSIS installer |
| **macOS** | DMG + ZIP |
| **Android** | APK |

## Что это?

**OpenChamber** — это open-source рабочее пространство для запуска, контроля и проверки AI-кодирования на десктопе, в браузере, редакторе и на мобильном.

**OpenChamber_ru** — это автоматическая сборка с добавленным русским языком. Процесс сборки:

1. Workflow проверяет наличие нового релиза оригинального OpenChamber
2. Клонирует оригинал нужной версии
3. Добавляет файлы русской локали (`ru.ts`, `ru.settings.ts`)
4. Модифицирует i18n инфраструктуру для поддержки русского языка
5. Собирает приложения для Linux, Windows, macOS и Android
6. Публикует релиз с готовыми артефактами

## Как включить русский язык

1. Откройте OpenChamber
2. Перейдите в **Settings** (Настройки)
3. Найдите раздел **Language** (Язык)
4. Выберите **Русский**

## Быстрый старт

### Desktop — macOS, Windows, Linux

Скачайте нужный файл из [Releases](https://github.com/Gegaremant/OpenChamber_ru/releases/latest) и запустите.

**Linux:**
```bash
chmod +x OpenChamber_ru-*.AppImage
./OpenChamber_ru-*.AppImage
```

**Windows:** Запустите `.exe` файл.

**macOS:** Откройте `.dmg` и перетащите OpenChamber в Applications.

### Android

Скачайте `.apk` файл и установите на устройство.

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
