import * as vscode from 'vscode';
import * as path from 'path';
import { DocTreeItem, TocNode } from './types';
import { parseTocFile } from './tocParser';
import { readAllTitles, readTitle } from './frontmatterReader';

/**
 * TreeDataProvider для панели навигации.
 * Строит дерево разделов на основе YAML-оглавления.
 */
export class DocTreeDataProvider implements vscode.TreeDataProvider<DocTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DocTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootNodes: TocNode[] = [];
  private activeFilePath: string | null = null;
  private tocFilePath: string = '';
  private rootDir: string = '';

  constructor(
    private openFileCommand: string = 'docnav.openFile',
    private displayName: string = 'DocNav'
  ) {}

  /** Установить путь к YAML-файлу оглавления */
  setTocFilePath(filePath: string): void {
    this.tocFilePath = filePath;
  }

  /** Установить корневую директорию */
  setRootDir(dir: string): void {
    this.rootDir = dir;
  }

  /** Подсветить активный файл */
  setActiveFile(filePath: string): void {
    this.activeFilePath = filePath;
    this._onDidChangeTreeData.fire();
  }

  /** Получить корневые узлы (для expand-all) */
  getRootNodes(): TocNode[] {
    return this.rootNodes;
  }

  /** Полная перестройка дерева */
  async rebuild(): Promise<void> {
    if (!this.tocFilePath || !this.rootDir) {
      this.rootNodes = [];
      this._onDidChangeTreeData.fire();
      return;
    }

    try {
      // Извлекаем все пути к .md-файлам
      const { extractFilePaths } = require('./tocParser');
      const allPaths = extractFilePaths(this.tocFilePath);

      // Массовое чтение frontmatter
      const titles = readAllTitles(this.rootDir, allPaths);

      // Парсим оглавление
      this.rootNodes = parseTocFile(this.tocFilePath, this.rootDir, titles);
    } catch (error) {
      this.rootNodes = [];
      vscode.window.showErrorMessage(
        `${this.displayName}: ошибка при чтении оглавления: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this._onDidChangeTreeData.fire();
  }

  /** Обновить титул одного файла (при сохранении .md) */
  async updateTitle(filePath: string): Promise<void> {
    const relPath = this.getRelativePath(filePath);
    if (!relPath) return;

    const newTitle = readTitle(filePath);
    if (this.updateNodeTitle(this.rootNodes, relPath, newTitle)) {
      this._onDidChangeTreeData.fire();
    }
  }

  /** Рекурсивно обновить title узла */
  private updateNodeTitle(nodes: TocNode[], relPath: string, newTitle: string): boolean {
    for (const node of nodes) {
      if (node.filePath === relPath) {
        node.title = newTitle;
        return true;
      }
      if (this.updateNodeTitle(node.children, relPath, newTitle)) {
        return true;
      }
    }
    return false;
  }

  /** Получить относительный путь файла от rootDir */
  private getRelativePath(filePath: string): string | null {
    if (!this.rootDir) return null;
    const rel = path.relative(this.rootDir, filePath);
    return rel.startsWith('..') ? null : rel;
  }

  /** Проверить, есть ли файл в дереве (для авто-рефреша при сохранении) */
  hasFile(filePath: string): boolean {
    const relPath = this.getRelativePath(filePath);
    if (!relPath) return false;
    return this.findNode(this.rootNodes, relPath) !== null;
  }

  private findNode(nodes: TocNode[], relPath: string): TocNode | null {
    for (const node of nodes) {
      if (node.filePath === relPath) return node;
      const found = this.findNode(node.children, relPath);
      if (found) return found;
    }
    return null;
  }

  // --- TreeDataProvider implementation ---

  getTreeItem(element: DocTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DocTreeItem): DocTreeItem[] {
    if (!element) {
      // Корневой уровень
      return this.rootNodes.map((n) =>
        new DocTreeItem(
          n,
          n.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          this.openFileCommand
        )
      );
    }

    return element.tocNode.children.map((n) =>
      new DocTreeItem(
        n,
        n.children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        this.openFileCommand
      )
    );
  }

  getParent(element: DocTreeItem): DocTreeItem | undefined {
    const parent = element.tocNode.parent;
    if (!parent) return undefined;
    return new DocTreeItem(
      parent,
      parent.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
      this.openFileCommand
    );
  }
}
