#!/usr/bin/env node
// Локализует нативное меню Electron в packages/electron/main.mjs.
// Заменяет хардкод-лейблы шаблонов buildMacMenu/buildAutoHiddenMenu на русские,
// а ролевым пунктам ({ role: 'close' } и т.п.) добавляет RU-лейбл.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node patch-menu.mjs <path_to_main.mjs>');
  process.exit(2);
}

let src = fs.readFileSync(file, 'utf8');
const before = src;

const labelMap = [
  "'About OpenChamber'", "'О программе'",
  "'Check for Updates'", "'Проверить обновления'",
  "'Settings'", "'Настройки'",
  "'Reload Webview'", "'Перезагрузить веб-представление'",
  "'Restart'", "'Перезапустить'",
  "'Command Palette'", "'Палитра команд'",
  "'File'", "'Файл'",
  "'Edit'", "'Правка'",
  "'View'", "'Вид'",
  "'Window'", "'Окно'",
  "'Help'", "'Справка'",
  "'New Window'", "'Новое окно'",
  "'New Session'", "'Новая сессия'",
  "'New Worktree'", "'Новое рабочее дерево'",
  "'New Mini Chat'", "'Новый мини-чат'",
  "'Add Workspace'", "'Добавить рабочую область'",
  "'Copy'", "'Копировать'",
  "'Add Selection to Chat'", "'Добавить выделение в чат'",
  "'Toggle Right Sidebar'", "'Переключить правую панель'",
  "'Open Git Sidebar'", "'Открыть панель Git'",
  "'Open Files Sidebar'", "'Открыть панель файлов'",
  "'Toggle Terminal Dock'", "'Переключить терминал'",
  "'Toggle Terminal Expanded'", "'Развернуть терминал'",
  "'Light Theme'", "'Светлая тема'",
  "'Dark Theme'", "'Тёмная тема'",
  "'System Theme'", "'Системная тема'",
  "'Toggle Session Sidebar'", "'Переключить панель сессий'",
  "'Toggle Memory Debug'", "'Отладка памяти'",
  "'Zoom In'", "'Увеличить'",
  "'Zoom Out'", "'Уменьшить'",
  "'Reset Zoom'", "'Сбросить масштаб'",
  "'Keyboard Shortcuts'", "'Сочетания клавиш'",
  "'Show Diagnostics'", "'Показать диагностику'",
  "'Toggle Developer Tools'", "'Инструменты разработчика'",
  "'Clear Cache'", "'Очистить кэш'",
  "'Report a Bug'", "'Сообщить об ошибке'",
  "'Discuss an Idea'", "'Обсудить идею'",
  "'Join Discord'", "'Присоединиться к Discord'",
];

// label: 'X' -> label: 'RU'
for (let i = 0; i < labelMap.length; i += 2) {
  // заменяем только label: "...", чтобы не задевать код за пределами меню
  src = src.split(`label: ${labelMap[i]}`).join(`label: ${labelMap[i + 1]}`);
}

const roleMap = {
  undo: 'Отменить',
  redo: 'Повторить',
  cut: 'Вырезать',
  copy: 'Копировать',
  paste: 'Вставить',
  selectAll: 'Выделить всё',
  close: 'Закрыть',
  quit: 'Выйти',
  minimize: 'Свернуть',
  zoom: 'Увеличить',
  togglefullscreen: 'Полный экран',
  reload: 'Перезагрузить',
  forceReload: 'Перезагрузить без кэша',
  services: 'Службы',
  hide: 'Скрыть',
  hideOthers: 'Скрыть остальные',
};

// { role: 'close' } -> { role: 'close', label: 'Закрыть' }
for (const [role, label] of Object.entries(roleMap)) {
  const re = new RegExp(`\\{\\s*role:\\s*'${role}'\\s*\\}`, 'g');
  src = src.replace(re, `{ role: '${role}', label: '${label}' }`);
}

fs.writeFileSync(file, src);
if (src === before) {
  console.log('  ✓ patch-menu: изменений нет');
} else {
  console.log(`  ✓ patch-menu: локализовано лейблов/ролей (${src.length - before.length} знаков)`);
}