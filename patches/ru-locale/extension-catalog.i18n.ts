/** Русский блок для extension-catalog.i18n.ts — вставляется в свежий файл апстрима. */
export const extensionCatalogI18n = {
  ru: {
    'settings.integrations.extensionCatalog.title': 'Расширения OpenChamber',
    'settings.integrations.extensionCatalog.info': 'Необязательные дополнения от команды OpenChamber. Установите любое здесь — и оно появится там, где вы его используете. Установленные расширения также перечислены в Настройках → Расширения.',
    'settings.integrations.extensionCatalog.excalidraw.name': 'Excalidraw',
    'settings.integrations.extensionCatalog.excalidraw.description': 'Рисуйте в файлах .excalidraw и в заметках Obsidian прямо в разделе «Файлы».',
    'settings.integrations.extensionCatalog.status.paused': 'Выключено',
    'settings.integrations.extensionCatalog.status.needsApproval': 'Требуется разрешение',
    'settings.integrations.extensionCatalog.actions.enable': 'Включить',
    'settings.integrations.extensionCatalog.actions.manage': 'Открыть «Расширения»',
    'settings.integrations.extensionCatalog.dialog.remove.title': 'Убрать расширение',
    'settings.integrations.extensionCatalog.dialog.remove.description': 'Убрать {name} из этого OpenChamber? Ваши файлы останутся как есть.',
    'settings.integrations.extensionCatalog.toast.enabled': '{name} включено',
    'settings.integrations.extensionCatalog.toast.enableFailed': 'Не удалось включить {name}',
  },
} as const;
