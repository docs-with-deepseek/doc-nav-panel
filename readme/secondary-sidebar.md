# Добавление панели в Secondary Sidebar (рядом с Copilot Chat)

## Обзор

VS Code позволяет разместить view-контейнер в правом сайдбаре (Secondary Sidebar / Auxiliary Bar) — там же, где находится Copilot Chat. Это даёт возможность открывать панель MD Tools справа от редактора.

## Необходимые условия

- VS Code **1.88.0** или выше (поддержка `viewsContainers.secondarySidebar` добавлена в 1.88)
- `engines.vscode` в package.json: `"^1.88.0"`
- `@types/vscode`: `"1.88.0"`

## package.json

### viewsContainers

Добавить контейнер с ключом `secondarySidebar`:

```json
"viewsContainers": {
  "activitybar": [
    { "id": "md-tools-panel", "title": "MD Tools", "icon": "resources/icon.svg" }
  ],
  "secondarySidebar": [
    { "id": "md-tools-secondary", "title": "MD Tools", "icon": "resources/icon.svg" }
  ]
}
```

### views

Привязать view к новому контейнеру:

```json
"views": {
  "md-tools-panel": [
    { "type": "webview", "id": "md-tools-view", "name": "Инструменты" }
  ],
  "md-tools-secondary": [
    { "type": "webview", "id": "md-tools-view-secondary", "name": "Инструменты" }
  ]
}
```

## extension.ts

### Регистрация провайдера

Для каждого view нужен отдельный экземпляр `WebviewViewProvider`:

```typescript
class MdToolsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'md-tools-view';
  public static readonly viewTypeSecondary = 'md-tools-view-secondary';
  // ...
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new MdToolsViewProvider(context.extensionUri);
  const providerSecondary = new MdToolsViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MdToolsViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MdToolsViewProvider.viewTypeSecondary, providerSecondary, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
}
```

### Кнопка переключения

Для программного открытия панели в правом сайдбаре используется команда `workbench.view.extension.<container-id>`:

```typescript
case 'toggleSecondarySidebar':
  vscode.commands.executeCommand('workbench.view.extension.md-tools-secondary');
  break;
```

Эта команда:
1. Открывает Secondary Sidebar (если закрыт)
2. Фокусирует view-контейнер `md-tools-secondary`

## Итоговая структура

```
package.json
├── viewsContainers
│   ├── activitybar → md-tools-panel
│   └── secondarySidebar → md-tools-secondary
├── views
│   ├── md-tools-panel → md-tools-view
│   └── md-tools-secondary → md-tools-view-secondary
└── commands (общие для обоих панелей)

src/extension.ts
├── MdToolsViewProvider (один класс)
├── provider (для левой панели)
├── providerSecondary (для правой панели)
└── toggleSecondarySidebar (кнопка переключения)
```
