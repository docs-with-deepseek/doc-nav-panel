import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DocTreeDataProvider } from './treeDataProvider';
import { InputWebviewProvider } from './inputWebview';
import { readTitle, readFirstHeadingLevel, readAllTitles, readTocTreeLvlFromFrontmatter } from './frontmatterReader';
import { DocTreeItem, TocNode } from './types';
import { parseTocFile, extractFilePaths } from './tocParser';

interface PanelConfig {
  ns: string;
  displayName: string;
  viewContainerId: string;
  webviewViewId: string;
  treeViewId: string;
}

class PanelController {
  private treeProvider: DocTreeDataProvider;
  private inputProvider: InputWebviewProvider;
  private treeView!: vscode.TreeView<vscode.TreeItem>;

  constructor(
    private context: vscode.ExtensionContext,
    private cfg: PanelConfig
  ) {
    const openCmd = `${cfg.ns}.openFile`;
    this.treeProvider = new DocTreeDataProvider(openCmd, cfg.displayName);
    this.inputProvider = new InputWebviewProvider(
      () => this.getTocFilePath(),
      () => this.getRootPath(),
      cfg.displayName
    );

    this.registerAll();
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return '';
  }

  private getTocFilePath(): string {
    return vscode.workspace.getConfiguration(this.cfg.ns).get<string>('tocFilePath', '');
  }

  private getRootPath(): string {
    return vscode.workspace.getConfiguration(this.cfg.ns).get<string>('rootPath', '');
  }

  private getResolvedRootPath(): string {
    const configured = this.getRootPath();
    const wsRoot = this.getWorkspaceRoot();
    if (configured) {
      return path.isAbsolute(configured) ? configured : path.resolve(wsRoot, configured);
    }
    return wsRoot;
  }

  private async saveTocFilePath(value: string): Promise<void> {
    await vscode.workspace.getConfiguration(this.cfg.ns).update('tocFilePath', value, vscode.ConfigurationTarget.Workspace);
  }

  private async saveRootPath(value: string): Promise<void> {
    await vscode.workspace.getConfiguration(this.cfg.ns).update('rootPath', value, vscode.ConfigurationTarget.Workspace);
  }

  private resolveTocFullPath(): string {
    const tocFile = this.getTocFilePath();
    const wsRoot = this.getWorkspaceRoot();
    if (!tocFile || !wsRoot) return '';

    if (path.isAbsolute(tocFile)) return tocFile;

    return path.resolve(wsRoot, tocFile);
  }

  private msg(text: string): string {
    return `${this.cfg.displayName}: ${text}`;
  }

  private async rebuildTree(): Promise<void> {
    const tocFullPath = this.resolveTocFullPath();
    const rootDir = this.getResolvedRootPath();

    if (!tocFullPath || !rootDir) {
      this.treeProvider.setTocFilePath('');
      this.treeProvider.setRootDir('');
      await this.treeProvider.rebuild();
      return;
    }

    this.treeProvider.setTocFilePath(tocFullPath);
    this.treeProvider.setRootDir(rootDir);
    await this.treeProvider.rebuild();
  }

  private async expandNodes(nodes: TocNode[]): Promise<void> {
    for (const node of nodes) {
      try {
        const collapsible = node.children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
        const treeItem = new DocTreeItem(node, collapsible, `${this.cfg.ns}.openFile`);
        await this.treeView.reveal(treeItem, { expand: true });
      } catch {
        // Элемент может быть не в DOM — игнорируем
      }
      if (node.children.length > 0) {
        await this.expandNodes(node.children);
      }
    }
  }

  private annotateTocLevelsInFile(yamlFilePath: string, rootDir: string): { processed: number; errors: number } {
    const content = fs.readFileSync(yamlFilePath, 'utf-8');
    const lines = content.split('\n');

    let inputFilesIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('input-files:')) {
        inputFilesIdx = i;
        break;
      }
    }

    if (inputFilesIdx === -1) {
      throw new Error('Секция input-files не найдена в YAML-файле');
    }

    let processed = 0;
    let errors = 0;
    const annotationRegex = /\(toc-tree-lvl=(\d+|\?)\)\s*/;

    for (let i = inputFilesIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^\s*#/.test(line)) continue;

      const fileMatch = trimmed.match(/^-\s+(.+)$/);
      if (!fileMatch) continue;

      const relPath = fileMatch[1].trim();
      if (!relPath.endsWith('.md')) continue;

      const isAnnotation = /annotation|аннотация/i.test(path.basename(relPath, '.md'));

      let tocTreeLvl: number | '?' = '?';
      if (!isAnnotation) {
        const fullPath = path.resolve(rootDir, relPath);
        // Приоритет: frontmatter → первый заголовок
        const fmLevel = readTocTreeLvlFromFrontmatter(fullPath);
        if (fmLevel !== null) {
          tocTreeLvl = fmLevel;
        } else {
          const level = readFirstHeadingLevel(fullPath);
          tocTreeLvl = level !== null ? level : '?';
        }
      }

      let commentIdx = -1;
      for (let j = i - 1; j > inputFilesIdx; j--) {
        const prevTrimmed = lines[j].trim();
        if (prevTrimmed === '') continue;
        if (/^#{3,}/.test(prevTrimmed)) continue;
        if (prevTrimmed.startsWith('#')) {
          commentIdx = j;
          break;
        }
        break;
      }

      if (commentIdx === -1) continue;

      const tocTag = `(toc-tree-lvl=${tocTreeLvl})`;

      const commentLine = lines[commentIdx];

      if (annotationRegex.test(commentLine)) {
        // Уже есть аннотация → заменить
        lines[commentIdx] = commentLine.replace(annotationRegex, `${tocTag} `);
      } else {
        // Нет аннотации → вставить после #
        lines[commentIdx] = commentLine.replace(/^(\s*#\s*)/, `$1${tocTag} `);
      }

      processed++;
    }

    fs.writeFileSync(yamlFilePath, lines.join('\n'), 'utf-8');
    return { processed, errors };
  }

  private syncTocNumbersInFile(yamlFilePath: string, rootDir: string): { processed: number; errors: number } {
    const filePaths = extractFilePaths(yamlFilePath);
    const titles = readAllTitles(rootDir, filePaths);
    const tree = parseTocFile(yamlFilePath, rootDir, titles);

    const nodeMap = new Map<string, TocNode>();
    function collectNodes(nodes: TocNode[]) {
      for (const node of nodes) {
        nodeMap.set(node.filePath, node);
        collectNodes(node.children);
      }
    }
    collectNodes(tree);

    const content = fs.readFileSync(yamlFilePath, 'utf-8');
    const lines = content.split('\n');

    let inputFilesIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('input-files:')) {
        inputFilesIdx = i;
        break;
      }
    }

    if (inputFilesIdx === -1) {
      throw new Error('Секция input-files не найдена в YAML-файле');
    }

    let processed = 0;
    let errors = 0;

    for (let i = inputFilesIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === '') continue;
      if (/^\s*#/.test(line)) continue;
      if (/^#{3,}/.test(trimmed)) continue;

      const fileMatch = trimmed.match(/^-\s+(.+)$/);
      if (!fileMatch) continue;

      let relPath = fileMatch[1].trim();
      const pipeIdx = relPath.indexOf('|');
      if (pipeIdx !== -1) {
        relPath = relPath.substring(0, pipeIdx).trim();
      }

      if (!relPath.endsWith('.md')) continue;

      const node = nodeMap.get(relPath);
      if (!node || node.tocTreeLvl === undefined) continue;

      let commentIdx = -1;
      for (let j = i - 1; j > inputFilesIdx; j--) {
        const prevTrimmed = lines[j].trim();
        if (prevTrimmed === '') continue;
        if (/^#{3,}/.test(prevTrimmed)) continue;
        if (prevTrimmed.startsWith('#')) {
          commentIdx = j;
          break;
        }
        break;
      }

      if (commentIdx === -1) continue;

      const commentLine = lines[commentIdx];
      const commentIndentMatch = commentLine.match(/^(\s*)/);
      const commentIndent = commentIndentMatch ? commentIndentMatch[1] : '';

      const tocTreeLvl = node.tocTreeLvl;
      const tocTag = `(toc-tree-lvl=${tocTreeLvl})`;

      const nodeNumber = node.number ? node.number.replace(/\.$/, '') : '';
      const title = node.title;

      const commentIndentNew = typeof tocTreeLvl === 'number'
        ? '  '.repeat(tocTreeLvl)
        : commentIndent;

      let newCommentLine: string;
      if (nodeNumber) {
        newCommentLine = commentIndentNew + '# ' + tocTag + ' ' + nodeNumber + (title ? ' ' + title : '');
      } else {
        newCommentLine = commentIndentNew + '# ' + tocTag + (title ? ' ' + title : '');
      }

      lines[commentIdx] = newCommentLine;

      if (typeof tocTreeLvl === 'number') {
        const baseIndent = '  ';
        const extraIndent = '  '.repeat(tocTreeLvl - 1);
        lines[i] = `${baseIndent}- ${extraIndent}${relPath}`;
      }

      processed++;
    }

    fs.writeFileSync(yamlFilePath, lines.join('\n'), 'utf-8');
    return { processed, errors };
  }

  private registerAll(): void {
    const { ns, treeViewId, webviewViewId } = this.cfg;
    const { subscriptions } = this.context;

    // TreeView
    this.treeView = vscode.window.createTreeView(treeViewId, {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
    });

    // WebviewView
    subscriptions.push(
      vscode.window.registerWebviewViewProvider(webviewViewId, this.inputProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );

    // Input callbacks
    this.inputProvider.setOnTocFileChange(async (value: string) => {
      await this.saveTocFilePath(value);
    });

    this.inputProvider.setOnRootDirChange(async (value: string) => {
      await this.saveRootPath(value);
    });

    this.inputProvider.setOnApply(async () => {
      await this.rebuildTree();
    });

    // --- Commands ---

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.openFile`, async (tocNode) => {
        if (!tocNode || !tocNode.fullPath) return;

        const fullPath = tocNode.fullPath;
        if (!fs.existsSync(fullPath)) {
          vscode.window.showWarningMessage(this.msg(`файл не найден: ${fullPath}`));
          return;
        }

        const doc = await vscode.workspace.openTextDocument(fullPath);
        await vscode.window.showTextDocument(doc);
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.refreshTree`, async () => {
        await this.rebuildTree();
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.expandAll`, async () => {
        const rootNodes = this.treeProvider.getRootNodes();
        await this.expandNodes(rootNodes);
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.annotateTocLevels`, async () => {
        const tocFullPath = this.resolveTocFullPath();
        const rootDir = this.getResolvedRootPath();

        if (!tocFullPath || !rootDir) {
          vscode.window.showErrorMessage(this.msg('укажите YAML-файл оглавления и корневую директорию'));
          return;
        }

        try {
          const result = this.annotateTocLevelsInFile(tocFullPath, rootDir);
          vscode.window.showInformationMessage(
            this.msg(`обработано файлов: ${result.processed}, ошибок: ${result.errors}`)
          );
          await this.rebuildTree();
        } catch (error) {
          vscode.window.showErrorMessage(
            this.msg(`ошибка аннотации: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.syncTocNumbers`, async () => {
        const tocFullPath = this.resolveTocFullPath();
        const rootDir = this.getResolvedRootPath();

        if (!tocFullPath || !rootDir) {
          vscode.window.showErrorMessage(this.msg('укажите YAML-файл оглавления и корневую директорию'));
          return;
        }

        try {
          const result = this.syncTocNumbersInFile(tocFullPath, rootDir);
          vscode.window.showInformationMessage(
            this.msg(`синхронизировано записей: ${result.processed}, ошибок: ${result.errors}`)
          );
          await this.rebuildTree();
        } catch (error) {
          vscode.window.showErrorMessage(
            this.msg(`ошибка синхронизации: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.openTocFile`, async () => {
        const tocFullPath = this.resolveTocFullPath();
        if (!tocFullPath) {
          vscode.window.showErrorMessage(this.msg('укажите YAML-файл оглавления в настройках'));
          return;
        }
        if (!fs.existsSync(tocFullPath)) {
          vscode.window.showErrorMessage(this.msg(`файл не найден: ${tocFullPath}`));
          return;
        }
        const doc = await vscode.workspace.openTextDocument(tocFullPath);
        await vscode.window.showTextDocument(doc);
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.copyRelativePath`, (item: DocTreeItem | TocNode) => {
        const tocNode: TocNode | undefined = (item as DocTreeItem).tocNode ?? (item as TocNode);
        if (!tocNode) return;
        vscode.env.clipboard.writeText(tocNode.filePath);
        vscode.window.showInformationMessage(this.msg(`путь скопирован — ${tocNode.filePath}`));
      })
    );

    subscriptions.push(
      vscode.commands.registerCommand(`${ns}.copyAbsolutePath`, (item: DocTreeItem | TocNode) => {
        const tocNode: TocNode | undefined = (item as DocTreeItem).tocNode ?? (item as TocNode);
        if (!tocNode) return;
        vscode.env.clipboard.writeText(tocNode.fullPath);
        vscode.window.showInformationMessage(this.msg(`путь скопирован — ${tocNode.fullPath}`));
      })
    );

    // --- Auto-update ---

    subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const tocFullPath = this.resolveTocFullPath();
        if (tocFullPath && doc.fileName === tocFullPath) {
          this.rebuildTree();
        }
      })
    );

    let saveDebounce: NodeJS.Timeout | undefined;
    subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!doc.fileName.endsWith('.md')) return;

        if (this.treeProvider.hasFile(doc.fileName)) {
          clearTimeout(saveDebounce);
          saveDebounce = setTimeout(() => {
            this.treeProvider.updateTitle(doc.fileName);
          }, 300);
        }
      })
    );

    subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.uri.scheme === 'file') {
          this.treeProvider.setActiveFile(editor.document.uri.fsPath);
        }
      })
    );

    // Initial build
    this.rebuildTree();
  }
}

export function activate(context: vscode.ExtensionContext) {
  new PanelController(context, {
    ns: 'docnav',
    displayName: 'DocNav',
    viewContainerId: 'docnav-sidebar',
    webviewViewId: 'docnav.inputPanel',
    treeViewId: 'docnav.tocTree',
  });

  new PanelController(context, {
    ns: 'docnavDoppel',
    displayName: 'DocNavDoppel',
    viewContainerId: 'docnav-doppel-sidebar',
    webviewViewId: 'docnavDoppel.inputPanel',
    treeViewId: 'docnavDoppel.tocTree',
  });
}

export function deactivate() {
  // Cleanup через subscriptions контекста
}
