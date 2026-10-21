/** The find bar that searches the changeset in the diff view. Merged into each locale's main dictionary. */
export const diffFindI18n = {
  en: {
    'diffFind.placeholder': 'Find in changes',
    'diffFind.nextAria': 'Next match',
    'diffFind.previousAria': 'Previous match',
    'diffFind.closeAria': 'Close search',
    'diffFind.noMatches': 'No matches',
    'diffFind.countAria': '{current} of {total}',
    'diffFind.searchingAria': 'Still reading files…',
    'diffFind.failedCount': "Files that couldn't be searched: {count}",
  },
  ru: {
    'diffFind.placeholder': 'Поиск по изменениям',
    'diffFind.nextAria': 'Следующее совпадение',
    'diffFind.previousAria': 'Предыдущее совпадение',
    'diffFind.closeAria': 'Закрыть поиск',
    'diffFind.noMatches': 'Совпадений нет',
    'diffFind.countAria': '{current} из {total}',
    'diffFind.searchingAria': 'Файлы ещё читаются…',
    'diffFind.failedCount': 'Файлы, поиск в которых не удался: {count}',
  },
} as const;
