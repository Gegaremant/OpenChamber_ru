/** Русский блок для stacks.i18n.ts — вставляется в свежий файл апстрима. */
export const stacksI18n = {
  ru: {
    'stacks.preview.label': 'Стек',
    'stacks.preview.position': '{position} из {size}',
    'stacks.preview.trunk': 'Ветка, на которую попадает стек',
    'stacks.preview.rebaseOnHost': 'Ребейс стека на GitHub',
    'stacks.merge.alsoBelow.one': 'Это также вливает {reference} — слой ниже.',
    'stacks.merge.alsoBelow.other': 'Это также вливает {count} слоев ниже, начиная с нижнего: {references}.',
    'stacks.toast.mergedWithBelow.one': '{reference} влит со слоем ниже',
    'stacks.toast.mergedWithBelow.other': '{reference} влит с {count} слоями ниже',
    'stacks.actions.newOnTop': 'Новая ветка сверху…',
    'stacks.create.stacksOn': 'Стеки на {reference}',
    'stacks.toast.createdStacked': 'Пулл-реквест создан и добавлен в стек',
    'stacks.toast.createdNotStacked': 'Пулл-реквест создан, но GitHub не добавил его в стек',
    'stacks.toast.createdNotStackedDescription': 'Целевая ветка: {base}, поэтому проверка и вливание пройдут как для следующего слоя.',
    'sourceBoard.toast.mergeQueued': '{reference} добавлен в очередь вливания',
    'sourceBoard.toast.mergeRunning': 'GitHub вливает {reference}',
    'sourceBoard.toast.mergeRunningDescription': 'После завершения здесь появится статус влитого.',
  },
};
