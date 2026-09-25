# Кастомные темы

> Перевод официального гайда по темам для региональной сборки **OpenChamber_ru**. Изменений в формате нет — темы, созданные для любой версии OpenChamber, работают как есть.

OpenChamber поддерживает пользовательские темы. Положите JSON-файл в каталог тем и перезагрузите список — перезапуск приложения не нужен.

## Быстрый старт

1. Создайте каталог тем:
   ```bash
   mkdir -p ~/.config/openchamber/themes
   ```

2. Создайте JSON-файл темы (например, `my-theme.json`) в формате ниже.

3. В OpenChamber: **Settings → Theme → Reload themes** (Настройки → Тема → Перезагрузить темы).

4. Выберите тему из списка.

## Где хранятся темы

| Платформа | Путь |
|----------|------|
| macOS/Linux | `~/.config/openchamber/themes/` |

## Формат темы

```json
{
  "metadata": {
    "id": "my-custom-theme",
    "name": "My Custom Theme",
    "description": "A custom theme for OpenChamber",
    "version": "1.0.0",
    "variant": "dark",
    "tags": ["dark", "custom"]
  },
  "colors": {
    "primary": {
      "base": "#EC8B49",
      "hover": "#DA702C",
      "active": "#F9AE77",
      "foreground": "#100F0F",
      "muted": "#EC8B4980",
      "emphasis": "#F9AE77"
    },
    "surface": {
      "background": "#100F0F",
      "foreground": "#CECDC3",
      "muted": "#1C1B1A90",
      "mutedForeground": "#878580",
      "elevated": "#1C1A1990",
      "elevatedForeground": "#CECDC3",
      "overlay": "#00000080",
      "subtle": "#1e1d1c"
    },
    "interactive": {
      "border": "#343331",
      "borderHover": "#403E3C",
      "borderFocus": "#EC8B49",
      "selection": "#f4f4f41f",
      "selectionForeground": "#CECDC3",
      "focus": "#EC8B49",
      "focusRing": "#EC8B4950",
      "cursor": "#CECDC3",
      "hover": "#ffffff18",
      "active": "#ffffff1f"
    },
    "status": {
      "error": "#D14D41",
      "errorForeground": "#100F0F",
      "errorBackground": "#AF302920",
      "errorBorder": "#AF302950",
      "warning": "#DA702C",
      "warningForeground": "#100F0F",
      "warningBackground": "#BC521520",
      "warningBorder": "#BC521550",
      "success": "#A0AF54",
      "successForeground": "#100F0F",
      "successBackground": "#66800B20",
      "successBorder": "#66800B50",
      "info": "#4385BE",
      "infoForeground": "#100F0F",
      "infoBackground": "#205EA620",
      "infoBorder": "#205EA650"
    },
    "pr": {
      "open": "#A0AF54",
      "draft": "#878580",
      "blocked": "#DA702C",
      "merged": "#8B7EC8",
      "closed": "#D14D41"
    },
    "syntax": {
      "base": {
        "background": "#1C1B1A",
        "foreground": "#CECDC3",
        "comment": "#878580",
        "keyword": "#4385BE",
        "string": "#3AA99F",
        "number": "#8B7EC8",
        "function": "#DA702C",
        "variable": "#CECDC3",
        "type": "#D0A215",
        "operator": "#D14D41"
      },
      "tokens": {
        "commentDoc": "#575653",
        "stringEscape": "#CECDC3",
        "keywordImport": "#D14D41",
        "storageModifier": "#4385BE",
        "functionCall": "#DA702C",
        "method": "#879A39",
        "variableProperty": "#4385BE",
        "variableOther": "#879A39",
        "variableGlobal": "#CE5D97",
        "variableLocal": "#282726",
        "parameter": "#CECDC3",
        "constant": "#CECDC3",
        "class": "#DA702C",
        "className": "#DA702C",
        "interface": "#D0A215",
        "struct": "#DA702C",
        "enum": "#DA702C",
        "typeParameter": "#DA702C",
        "namespace": "#D0A215",
        "module": "#D14D41",
        "tag": "#4385BE",
        "jsxTag": "#CE5D97",
        "tagAttribute": "#D0A215",
        "tagAttributeValue": "#3AA99F",
        "boolean": "#D0A215",
        "decorator": "#D0A215",
        "label": "#CE5D97",
        "punctuation": "#878580",
        "macro": "#4385BE",
        "preprocessor": "#CE5D97",
        "regex": "#3AA99F",
        "url": "#4385BE",
        "key": "#DA702C",
        "exception": "#CE5D97"
      },
      "highlights": {
        "diffAdded": "#879A39",
        "diffAddedBackground": "#66800B20",
        "diffRemoved": "#D14D41",
        "diffRemovedBackground": "#AF302920",
        "diffModified": "#4385BE",
        "diffModifiedBackground": "#205EA620",
        "lineNumber": "#403E3C",
        "lineNumberActive": "#CECDC3"
      }
    },
    "markdown": {
      "heading1": "#fbf9e6",
      "heading2": "#e6e4d2",
      "heading3": "#CECDC3",
      "heading4": "#CECDC3",
      "link": "#4385BE",
      "linkHover": "#205EA6",
      "inlineCode": "#A0AF53",
      "inlineCodeBackground": "#1C1B1A",
      "blockquote": "#878580",
      "blockquoteBorder": "#343331",
      "listMarker": "#D0A21599"
    },
    "chat": {
      "userMessage": "#CECDC3",
      "userMessageBackground": "#2d1d15",
      "assistantMessage": "#CECDC3",
      "assistantMessageBackground": "#100F0F",
      "timestamp": "#878580",
      "divider": "#343331"
    },
    "tools": {
      "background": "#1C1B1A50",
      "border": "#42403e9d",
      "headerHover": "#34333150",
      "icon": "#aca7a1",
      "title": "#CECDC3",
      "description": "#878580",
      "edit": {
        "added": "#879A39",
        "addedBackground": "#66800B25",
        "removed": "#D14D41",
        "removedBackground": "#AF302925",
        "lineNumber": "#403E3C"
      }
    }
  },
  "config": {
    "fonts": {
      "sans": "\"IBM Plex Mono\", monospace",
      "mono": "\"IBM Plex Mono\", monospace",
      "heading": "\"IBM Plex Mono\", monospace"
    },
    "radius": {
      "none": "0",
      "sm": "0.325rem",
      "md": "0.75rem",
      "lg": "1.125rem",
      "xl": "1.5rem",
      "full": "9999px"
    },
    "transitions": {
      "fast": "150ms ease",
      "normal": "250ms ease",
      "slow": "350ms ease"
    }
  }
}
```

## Требование к полям surface

- `colors.surface.muted` и `colors.surface.elevated` всегда должны иметь альфу 90 (`...90` в 8-значном hex, например `#1C1B1A90`).

## Проверка

Темы проверяются при загрузке. Некорректные темы пропускаются с предупреждением в консоли.

Частые проблемы:
- отсутствуют обязательные поля
- некорректный `variant` (должен быть `"light"` или `"dark"`)
- размер файла больше 512 КБ

## Советы

- Используйте hex с альфой для прозрачности (например, `#FFFFFF20`)
- Больше примеров — встроенные темы в `packages/ui/src/lib/theme/themes/`
- `id` темы должен быть уникальным; дубликаты пропускаются