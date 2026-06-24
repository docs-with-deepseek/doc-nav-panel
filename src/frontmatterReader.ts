import * as fs from 'fs';
import * as path from 'path';

/**
 * Читает YAML-frontmatter из .md-файла и извлекает поле title.
 *
 * Формат frontmatter:
 * ```
 * ---
 * order: 5
 * title: Приложение 2. Работа с SSH‑ключами
 * ---
 * ```
 *
 * Если frontmatter отсутствует или поле title не задано —
 * возвращает имя файла без расширения.
 */

/** Извлекает title из frontmatter одного файла */
export function readTitle(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      return path.basename(filePath, '.md');
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Ищем открывающий ---
    if (lines[0].trim() !== '---') {
      return path.basename(filePath, '.md');
    }

    // Собираем строки frontmatter до закрывающего ---
    const fmLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') break;
      fmLines.push(lines[i]);
    }

    // Простой парсинг ключ: значение (без библиотек для лёгкости)
    for (const fmLine of fmLines) {
      const colonIdx = fmLine.indexOf(':');
      if (colonIdx === -1) continue;

      const key = fmLine.substring(0, colonIdx).trim();
      if (key === 'title') {
        const value = fmLine.substring(colonIdx + 1).trim();
        // Убираем кавычки если есть
        const cleanValue = value.replace(/^["']|["']$/g, '');
        if (cleanValue) {
          return cleanValue;
        }
      }
    }

    return path.basename(filePath, '.md');
  } catch {
    return path.basename(filePath, '.md');
  }
}

/**
 * Читает первый markdown-заголовок из .md-файла (включая заголовки внутри HTML-комментариев).
 * Пропускает YAML-frontmatter (строки между ---).
 * Возвращает уровень заголовка (количество #) или null, если заголовок не найден.
 */
export function readFirstHeadingLevel(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let inFrontmatter = false;
    let fmOpened = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!fmOpened && trimmed === '---') {
        fmOpened = true;
        inFrontmatter = true;
        continue;
      }

      if (inFrontmatter && trimmed === '---') {
        inFrontmatter = false;
        continue;
      }

      if (inFrontmatter) continue;

      let checkLine = trimmed;
      if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
        checkLine = trimmed.slice(4, -3).trim();
      }

      const headingMatch = checkLine.match(/^(#{1,6})\s/);
      if (headingMatch) {
        return headingMatch[1].length;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Читает toc-tree-lvl из frontmatter .md-файла.
 *
 * Ищет поле toc-tree-lvl в YAML-frontmatter (между ---).
 * Возвращает число уровня или null, если поле не задано или frontmatter отсутствует.
 */
export function readTocTreeLvlFromFrontmatter(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Ищем открывающий ---
    if (lines[0].trim() !== '---') return null;

    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '---') break;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.substring(0, colonIdx).trim();
      if (key === 'toc-tree-lvl') {
        const value = trimmed.substring(colonIdx + 1).trim();
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) {
          return num;
        }
        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Массовое чтение title для списка файлов.
 * @returns Map относительный_путь → title
 */
export function readAllTitles(
  rootDir: string,
  filePaths: string[]
): Map<string, string> {
  const titles = new Map<string, string>();

  for (const fp of filePaths) {
    const fullPath = path.resolve(rootDir, fp);
    titles.set(fp, readTitle(fullPath));
  }

  return titles;
}
