import * as fs from 'fs';
import * as path from 'path';
import { ParsedYamlLine, TocNode } from './types';

/**
 * Парсер YAML-оглавления (например, _contents.yaml).
 *
 * YAML-файл имеет нестандартный формат: содержит комментарии с номерами разделов,
 * закомментированные строки с пометками «скрыто на печати» и т.д.
 * Прямой парсинг js-yaml невозможен — используется пре-процессинг.
 */

/** Разбирает одну строку YAML-файла в структуру ParsedYamlLine */
function parseLine(line: string): ParsedYamlLine | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('input-files:') || trimmed.startsWith('---')) {
    return null; // пустые строки и заголовки YAML пропускаем
  }

  // Пропускаем строки-разделители из # (например, "##########")
  if (/^#{3,}/.test(trimmed)) {
    return null;
  }

  const indent = line.length - line.trimStart().length;
  const isComment = /^\s*#/.test(line);

  // Убираем пометку | скрыто на печати из строки
  let cleanTrimmed = trimmed;
  let isHidden = false;
  const pipeIdx = cleanTrimmed.indexOf('|');
  if (pipeIdx !== -1) {
    const marker = cleanTrimmed.substring(pipeIdx).toLowerCase();
    if (marker.includes('скрыто') || marker.includes('hidden')) {
      isHidden = true;
      cleanTrimmed = cleanTrimmed.substring(0, pipeIdx).trim();
    }
  }

  let commentText = '';
  let number: string | undefined;
  let filePath: string | null = null;
  let isFullyCommented = false;
  let isActive = false;
  let tocTreeLvl: number | '?' | undefined;

  if (isComment) {
    commentText = cleanTrimmed.replace(/^#\s*/, '');
    // Извлекаем номер раздела: "4.1.1", "X1", "2.5.1.X1" и т.д.
    const numMatch = commentText.match(/^([0-9]+(?:\.[0-9]+)*(?:\.[Xx][0-9]+)?|[Xx][0-9]+)/);
    number = numMatch ? numMatch[1] : undefined;

    // Извлекаем toc-tree-lvl из аннотации (toc-tree-lvl=N) или (toc-tree-lvl=?)
    const tocMatch = commentText.match(/\(toc-tree-lvl=(\d+|\?)\)/);
    if (tocMatch) {
      tocTreeLvl = tocMatch[1] === '?' ? '?' : parseInt(tocMatch[1], 10);
    }

    // Проверяем, полностью ли закомментирована строка (начинается с # -)
    isFullyCommented = /^\s*#\s*-/.test(line);
  } else {
    // Запись с файлом: "-   path/to/file.md"
    const pathMatch = cleanTrimmed.match(/^-\s+(.+)$/);
    if (pathMatch) {
      filePath = pathMatch[1].trim();
      isActive = true;
    }
  }

  // Активный элемент: комментарий с номером (не скрытый) ИЛИ запись с файлом
  const isSignificant = (isComment && !isFullyCommented && !isHidden) || isActive;

  if (!isSignificant) {
    return null;
  }

  return {
    raw: line,
    indent,
    isComment,
    commentText,
    number,
    filePath,
    isFullyCommented,
    isHidden,
    isActive,
    tocTreeLvl,
  };
}

/** Связывает номера разделов и toc-tree-lvl с файловыми записями */
function associateNumbers(lines: ParsedYamlLine[]): void {
  let pendingNumber: string | undefined;
  let pendingTocTreeLvl: number | '?' | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.isComment) {
      if (line.number) {
        pendingNumber = line.number;
      }
      if (line.tocTreeLvl !== undefined) {
        pendingTocTreeLvl = line.tocTreeLvl;
      }
      continue;
    }

    if (line.isActive && line.filePath) {
      if (pendingNumber) {
        line.number = pendingNumber;
        pendingNumber = undefined;
      }
      if (pendingTocTreeLvl !== undefined) {
        line.tocTreeLvl = pendingTocTreeLvl;
        pendingTocTreeLvl = undefined;
      }
      continue;
    }
  }
}

/** Автоопределение шага отступа по файловым записям */
function detectIndentUnit(lines: ParsedYamlLine[]): number {
  const indents = lines
    .filter((l) => l.isActive && l.filePath)
    .map((l) => l.indent)
    .filter((i) => i > 0);

  if (indents.length === 0) return 2;

  const unique = [...new Set(indents)].sort((a, b) => a - b);
  const minIndent = unique[0];

  if (unique.length === 1) return Math.max(minIndent, 2);

  const diffs: number[] = [];
  for (let i = 1; i < unique.length; i++) {
    diffs.push(unique[i] - unique[i - 1]);
  }

  function gcd(a: number, b: number): number {
    while (b) { const t = b; b = a % b; a = t; }
    return a;
  }

  let unit = diffs[0];
  for (let i = 1; i < diffs.length; i++) {
    unit = gcd(unit, diffs[i]);
  }

  return unit > 0 ? unit : Math.max(minIndent, 2);
}

/** Корректирует отступы файловых записей по контексту комментариев */
function adjustIndents(lines: ParsedYamlLine[]): void {
  let lastCommentIndent = 0;

  for (const line of lines) {
    if (line.isComment) {
      if (line.indent > lastCommentIndent) {
        lastCommentIndent = line.indent;
      }
    } else if (line.isActive && line.filePath) {
      if (lastCommentIndent > line.indent) {
        line.indent = lastCommentIndent;
      }
      lastCommentIndent = 0;
    }
  }
}

/** Строит иерархическое дерево из плоского списка ParsedYamlLine */
function buildTree(
  activeLines: ParsedYamlLine[],
  rootDir: string,
  titles: Map<string, string>
): TocNode[] {
  const rootNodes: TocNode[] = [];
  const stack: TocNode[] = [];

  const indentUnit = detectIndentUnit(activeLines);

  for (const line of activeLines) {
    if (!line.filePath) continue;

    const fullPath = path.resolve(rootDir, line.filePath);
    const title = titles.get(line.filePath) || path.basename(line.filePath, '.md');

    const level = Math.floor(line.indent / indentUnit);

    const node: TocNode = {
      number: line.number,
      title,
      filePath: line.filePath,
      fullPath,
      children: [],
      level,
      tocTreeLvl: line.tocTreeLvl,
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootNodes.push(node);
    } else {
      const parent = stack[stack.length - 1];
      node.parent = parent;
      parent.children.push(node);
    }

    stack.push(node);
  }

  return rootNodes;
}

/** Наследует номера разделов: если узел без номера — получает номер ближайшего предка */
function inheritNumbers(nodes: TocNode[]): void {
  for (const node of nodes) {
    if (!node.number && node.parent) {
      let ancestor: TocNode | undefined = node.parent;
      while (ancestor) {
        if (ancestor.number) {
          node.number = ancestor.number;
          break;
        }
        ancestor = ancestor.parent;
      }
    }
    inheritNumbers(node.children);
  }
}

/** Проверяет, есть ли в дереве хотя бы один узел с tocTreeLvl */
function hasAnyTocLevel(nodes: TocNode[]): boolean {
  for (const node of nodes) {
    if (node.tocTreeLvl !== undefined) return true;
    if (hasAnyTocLevel(node.children)) return true;
  }
  return false;
}

/** Автонумерация разделов на основе toc-tree-lvl */
function autoNumber(nodes: TocNode[]): void {
  const counters = [0, 0, 0, 0, 0, 0];

  function walk(node: TocNode): void {
    if (node.tocTreeLvl === '?' || node.tocTreeLvl === undefined) {
      node.number = undefined;
    } else {
      const n = node.tocTreeLvl;
      for (let i = 0; i <= n - 2; i++) {
        if (counters[i] === 0) counters[i] = 1;
      }
      counters[n - 1]++;
      for (let i = n; i < counters.length; i++) {
        counters[i] = 0;
      }
      node.number = counters.slice(0, n).join('.') + '.';
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }
}

/**
 * Основная функция: парсит YAML-файл оглавления и возвращает дерево узлов.
 *
 * @param yamlFilePath - абсолютный путь к YAML-файлу оглавления
 * @param rootDir - корневая директория для разрешения относительных путей
 * @param titles - Map относительный_путь → титул (заполняется после чтения frontmatter)
 */
export function parseTocFile(
  yamlFilePath: string,
  rootDir: string,
  titles?: Map<string, string>
): TocNode[] {
  if (!fs.existsSync(yamlFilePath)) {
    throw new Error(`YAML-файл не найден: ${yamlFilePath}`);
  }

  const content = fs.readFileSync(yamlFilePath, 'utf-8');
  const allLines = content.split('\n');

  // Пропускаем заголовочные комментарии до input-files:
  let startFrom = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].trim().startsWith('input-files:')) {
      startFrom = i + 1;
      break;
    }
  }

  // Шаг 1: разобрать строки начиная с input-files:
  const parsedLines: ParsedYamlLine[] = [];
  for (let i = startFrom; i < allLines.length; i++) {
    const parsed = parseLine(allLines[i]);
    if (parsed) {
      parsedLines.push(parsed);
    }
  }

  // Шаг 2: связать номера с файлами
  associateNumbers(parsedLines);

  // Шаг 3: скорректировать отступы по комментариям
  adjustIndents(parsedLines);

  // Шаг 4: отфильтровать только активные файловые записи
  const activeLines = parsedLines.filter((l) => l.isActive && l.filePath);

  // Шаг 5: построить дерево
  const titleMap = titles || new Map<string, string>();
  const tree = buildTree(activeLines, rootDir, titleMap);

  // Шаг 6: нумерация — автонумерация если есть toc-tree-lvl, иначе наследование из комментариев
  if (hasAnyTocLevel(tree)) {
    autoNumber(tree);
  } else {
    inheritNumbers(tree);
  }

  return tree;
}

/**
 * Извлекает список всех относительных путей к .md-файлам из оглавления.
 * Используется для массового чтения frontmatter.
 */
export function extractFilePaths(yamlFilePath: string): string[] {
  if (!fs.existsSync(yamlFilePath)) {
    return [];
  }

  const content = fs.readFileSync(yamlFilePath, 'utf-8');
  const allLines = content.split('\n');

  // Пропускаем заголовочные комментарии до input-files:
  let startFrom = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].trim().startsWith('input-files:')) {
      startFrom = i + 1;
      break;
    }
  }

  const paths: string[] = [];

  for (let i = startFrom; i < allLines.length; i++) {
    const line = allLines[i];
    const trimmed = line.trim();
    if (trimmed === '' || /^\s*#/.test(line)) continue;

    const pathMatch = trimmed.match(/^-\s+(.+)$/);
    if (pathMatch) {
      const fp = pathMatch[1].trim();
      // Отфильтровываем не-.md файлы и пути с |
      if (fp.endsWith('.md') && !fp.includes('|')) {
        paths.push(fp);
      }
    }
  }

  return paths;
}
