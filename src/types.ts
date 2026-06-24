import * as vscode from 'vscode';

/** Узел оглавления — соответствует одному элементу в _contents.yaml */
export interface TocNode {
  /** Номер раздела из комментария (например, "4.1.1") */
  number?: string;
  /** Титул из frontmatter или fallback (имя файла) */
  title: string;
  /** Относительный путь из YAML (например, "user-manual/introduction/scope.md") */
  filePath: string;
  /** Абсолютный путь к файлу */
  fullPath: string;
  /** Дочерние узлы */
  children: TocNode[];
  /** Родительский узел */
  parent?: TocNode;
  /** Уровень вложенности (по отступам) */
  level: number;
  /** Уровень заголовка из (toc-tree-lvl=N), или '?' для аннотаций/файлов без заголовков */
  tocTreeLvl?: number | '?';
}

/** Результат парсинга одной строки YAML-оглавления */
export interface ParsedYamlLine {
  /** Исходная строка */
  raw: string;
  /** Количество ведущих пробелов */
  indent: number;
  /** Это комментарий? */
  isComment: boolean;
  /** Текст комментария (без #) */
  commentText: string;
  /** Извлечённый номер раздела из комментария */
  number?: string;
  /** Относительный путь к файлу (null для комментариев и пустых строк) */
  filePath: string | null;
  /** Строка полностью закомментирована (начинается с # -) */
  isFullyCommented: boolean;
  /** Помечен как скрытый на печати */
  isHidden: boolean;
  /** Строка активна (будет в дереве) */
  isActive: boolean;
  /** Уровень заголовка из (toc-tree-lvl=N), или '?' для аннотаций */
  tocTreeLvl?: number | '?';
}

/** Элемент дерева для TreeView */
export class DocTreeItem extends vscode.TreeItem {
  /** Узел оглавления */
  tocNode: TocNode;

  constructor(
    tocNode: TocNode,
    collapsibleState: vscode.TreeItemCollapsibleState,
    openCommand: string = 'docnav.openFile'
  ) {
    const label = tocNode.number
      ? `${tocNode.number} ${tocNode.title}`
      : tocNode.title;

    super(label, collapsibleState);

    this.tocNode = tocNode;
    this.id = tocNode.fullPath;
    this.description = tocNode.filePath;
    this.tooltip = `${label}\n${tocNode.filePath}`;

    // Иконка: файл или папка
    if (tocNode.children.length > 0) {
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'folder';
    } else {
      // Определяем иконку по расширению
      if (tocNode.filePath.endsWith('.md')) {
        this.iconPath = new vscode.ThemeIcon('markdown');
      } else {
        this.iconPath = new vscode.ThemeIcon('file');
      }
      this.contextValue = 'file';
    }

    // Команда при клике
    this.command = {
      command: openCommand,
      title: 'Открыть файл',
      arguments: [tocNode],
    };
  }
}
