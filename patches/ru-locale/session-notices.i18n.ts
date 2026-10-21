/** Session notice rows in the chat (`@/lib/opencode/session-notices`) — merged into each locale's main dictionary. */
export const sessionNoticesI18n = {
  en: {
    'chat.sessionNotice.restart': 'Continuing after restart',
    'chat.sessionNotice.commandFailed': 'Command failed to start: {command}',
    'chat.sessionNotice.moved': 'Moved to {folder}',
    'chat.sessionNotice.movedUnknown': 'Moved to another folder',
    'chat.sessionNotice.showDetails': 'Show what the agent received',
    'chat.sessionNotice.hideDetails': 'Hide what the agent received',
  },
  ru: {
    'chat.sessionNotice.restart': 'Продолжение после перезапуска',
    'chat.sessionNotice.commandFailed': 'Не удалось запустить команду: {command}',
    'chat.sessionNotice.moved': 'Сессия перемещена в {folder}',
    'chat.sessionNotice.movedUnknown': 'Сессия перемещена в другую папку',
    'chat.sessionNotice.showDetails': 'Показать, что получил агент',
    'chat.sessionNotice.hideDetails': 'Скрыть, что получил агент',
  },
} as const;
