import * as vscode from 'vscode';

/**
 * WebviewViewProvider для панели настроек (поля ввода).
 * Содержит два поля:
 * 1. Имя YAML-файла оглавления
 * 2. Корневая директория
 */
export class InputWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  // Callback-и при изменении значений
  private onTocFileChange?: (value: string) => void;
  private onRootDirChange?: (value: string) => void;
  private onApply?: () => void;

  constructor(
    private getTocFilePath: () => string,
    private getRootPath: () => string,
    private panelTitle: string = 'DocNav'
  ) {}

  /** Установить callback на изменение YAML-файла */
  setOnTocFileChange(cb: (value: string) => void): void {
    this.onTocFileChange = cb;
  }

  /** Установить callback на изменение корневой директории */
  setOnRootDirChange(cb: (value: string) => void): void {
    this.onRootDirChange = cb;
  }

  /** Установить callback на применение (Enter) */
  setOnApply(cb: () => void): void {
    this.onApply = cb;
  }

  /** Обновить значения полей из настроек */
  refresh(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'update',
        tocFile: this.getTocFilePath(),
        rootPath: this.getRootPath(),
      });
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml();

    // Обработка сообщений от webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'tocFileChanged':
          this.onTocFileChange?.(message.value);
          break;
        case 'rootPathChanged':
          this.onRootDirChange?.(message.value);
          break;
        case 'apply':
          this.onApply?.();
          break;
        case 'ready':
          // Webview готов — отправляем текущие значения
          this.refresh();
          break;
      }
    });
  }

  private getHtml(): string {
    const tocFile = this.getTocFilePath();
    const rootPath = this.getRootPath();

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #555);
      --input-focus-border: var(--vscode-focusBorder, #007fd4);
      --input-placeholder: var(--vscode-input-placeholderForeground, #888);
      --font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      --font-size: var(--vscode-font-size, 13px);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-family);
      font-size: var(--font-size);
      color: var(--vscode-foreground, #cccccc);
      padding: 8px 12px;
    }

    .panel-heading {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #999);
      letter-spacing: 1px;
      margin-bottom: 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-input-border, #555);
    }

    .field-group {
      margin-bottom: 8px;
    }

    label {
      display: block;
      margin-bottom: 3px;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #999);
      letter-spacing: 0.5px;
    }

    input {
      width: 100%;
      padding: 4px 6px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 2px;
      font-family: var(--font-family);
      font-size: var(--font-size);
      outline: none;
    }

    input:focus {
      border-color: var(--input-focus-border);
    }

    input::placeholder {
      color: var(--input-placeholder);
    }

    .hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #999);
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="panel-heading">${this.escapeHtml(this.panelTitle)}</div>
  <div class="field-group">
    <label for="tocFile">Файл оглавления</label>
    <input
      id="tocFile"
      type="text"
      placeholder="_contents.yaml"
      value="${this.escapeHtml(tocFile)}"
    />
    <div class="hint">Имя YAML-файла (относительно корневой директории)</div>
  </div>

  <div class="field-group">
    <label for="rootPath">Корневая директория</label>
    <input
      id="rootPath"
      type="text"
      placeholder="Корень workspace"
      value="${this.escapeHtml(rootPath)}"
    />
    <div class="hint">Директория-источник .md-файлов (относительно корня workspace)</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const tocFileEl = document.getElementById('tocFile');
    const rootPathEl = document.getElementById('rootPath');

    // Отправка при изменении
    let tocDebounce;
    tocFileEl.addEventListener('input', () => {
      clearTimeout(tocDebounce);
      tocDebounce = setTimeout(() => {
        vscode.postMessage({ type: 'tocFileChanged', value: tocFileEl.value });
      }, 300);
    });

    let rootDebounce;
    rootPathEl.addEventListener('input', () => {
      clearTimeout(rootDebounce);
      rootDebounce = setTimeout(() => {
        vscode.postMessage({ type: 'rootPathChanged', value: rootPathEl.value });
      }, 300);
    });

    // Enter = применить
    tocFileEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        vscode.postMessage({ type: 'tocFileChanged', value: tocFileEl.value });
        vscode.postMessage({ type: 'apply' });
      }
    });

    rootPathEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        vscode.postMessage({ type: 'rootPathChanged', value: rootPathEl.value });
        vscode.postMessage({ type: 'apply' });
      }
    });

    // Получение сообщений от расширения
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'update') {
        if (msg.tocFile !== undefined) tocFileEl.value = msg.tocFile;
        if (msg.rootPath !== undefined) rootPathEl.value = msg.rootPath;
      }
    });

    // Сигнал готовности
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
