/** Русский блок для compaction-settings.i18n.ts — вставляется в свежий файл апстрима. */
export const compactionSettingsI18n = {
  ru: {
    'settings.openchamber.defaults.compaction.title': 'Compaction',
    'settings.openchamber.defaults.compaction.auto': 'Compact automatically',
    'settings.openchamber.defaults.compaction.autoInfo': 'OpenCode summarizes a session on its own as it nears the model\'s context limit, and once more when a provider rejects a request as too long. When off, only /compact compacts, and a session that reaches the limit stops with an error.',
    'settings.openchamber.defaults.compaction.projectNote': 'Applies to every project. A project whose own OpenCode config sets these keeps its own values.',
    'settings.openchamber.defaults.compaction.buffer': 'Room before the limit',
    'settings.openchamber.defaults.compaction.bufferInfo': 'The share of the model\'s context window kept free. Compaction starts once the rest fills up, so 20% compacts at 80% full. By default OpenCode keeps 15% free, at least 16K.',
    'settings.openchamber.defaults.compaction.bufferDefault': 'Default (15%)',
    'settings.openchamber.defaults.compaction.keep': 'Recent context kept',
    'settings.openchamber.defaults.compaction.keepInfo': 'How much of the latest conversation stays word for word beside the summary after compaction. More keeps exact recent details but leaves less room for new work.',
    'settings.openchamber.defaults.compaction.keepDefault': 'Default ({count})',
    'settings.openchamber.defaults.compaction.tokens': '{count} tokens',
    'settings.openchamber.defaults.compaction.background': 'Compact in the background',
    'settings.openchamber.defaults.compaction.backgroundInfo': 'Experimental OpenCode feature. As a session nears compaction, OpenCode writes the summary ahead of time and swaps it in when compaction is due, so the session doesn\'t pause for it. A summary that ends up unused still costs tokens. Sessions under about 64K tokens skip it.',
  },
};
