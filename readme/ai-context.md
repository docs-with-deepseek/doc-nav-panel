# DocNav — AI Context

> **Контекст проекта для AI-ассистента.** Содержит всю информацию, необходимую для доработки расширения.

> [!IMPORTANT]
> **Обновляй этот файл после каждого изменения расширения.** Добавляй описание новых функций, правок, изменений архитектуры. Не удаляй предыдущую информацию — дополняй.

---

## 1. Обзор проекта

| Поле | Значение |
|---|---|
| **Название** | `docnav` (displayName: DocNav) |
| **Версия** | `0.0.1` |
| **Тип** | Расширение VS Code (TreeView + WebviewView в Activity Bar) |
| **Лицензия** | MIT |
| **Publisher** | `docnav` |
| **Репозиторий GitHub** | `git@github.com:docs-with-deepseek/doc-nav-panel.git` |
| **Язык** | TypeScript 5.3, ES2022 |
| **Сборка** | esbuild → CommonJS → out/extension.js |
| **Публикация** | `vsce package` → .vsix |
| **CI/CD** | GitHub Actions (`.github/workflows/ci.yml`) |
| **Движок** | VS Code >= 1.85.0 |

### Назначение

Панель навигации по документации на основе YAML-оглавления (`_contents.yaml`). Отображает дерево разделов в боковой панели VS Code, позволяет открывать `.md`-файлы по клику, аннотировать уровни заголовков и синхронизировать нумерацию разделов.

Поддерживает **два независимых экземпляра** (DocNav + DocNavDoppel) для одновременной работы с двумя наборами документации. Обе панели всегда видны в Activity Bar.

---

## 2. Архитектура

### Точка входа

```
activate() → new PanelController(docnav) + new PanelController(docnavDoppel)
```

Каждый `PanelController` инкапсулирует полный жизненный цикл одной панели:
- **TreeDataProvider** — строит дерево из YAML-оглавления
- **InputWebviewProvider** — панель настроек (webview с полями ввода)
- **Команды** — openFile, refreshTree, expandAll, annotateTocLevels, syncTocNumbers, openTocFile, copyRelativePath, copyAbsolutePath

### Диаграмма потока данных

```
_contents.yaml → tocParser.ts → TocNode[] → treeDataProvider.ts → TreeView (UI)
                                              ↓
                              annotateTocLevels / syncTocNumbers (мутация YAML)

.md файлы → frontmatterReader.ts → title, toc-tree-lvl, heading level
```

---

## 3. Структура файлов

```
doc-nav-panel/
├── .gitignore                  # Игнорирует: build/, .vscode/, out/, node_modules/, *.vsix
├── .vscodeignore               # Исключения для VSIX-пакета
├── .vscode/
│   └── settings.json           # Рабочие настройки (docnav.*, docnavDoppel.*)
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions: сборка + упаковка VSIX
├── kilo.json                   # Kilo config: snapshot=false
├── LICENSE                     # MIT
├── README.md                   # Документация для маркетплейса
├── package.json                # Манифест расширения
├── tsconfig.json               # Конфиг TypeScript
├── esbuild.config.js           # Конфиг сборки esbuild
├── build.ps1                   # PowerShell-скрипт сборки расширения
├── build.cmd                   # CMD-обёртка для сборки двойным кликом
├── readme/
│   ├── ai-context.md           # Этот файл — AI-контекст проекта
│   └── _index.md               # Индекс документации
├── media/
│   ├── icon.svg                 # Иконка DocNav — Activity Bar (SVG, currentColor)
│   ├── icon.png                 # Иконка DocNav — marketplace (PNG 128×128)
│   ├── icon-doppel.svg          # Иконка DocNavDoppel (SVG)
│   └── icon-doppel.png          # Иконка DocNavDoppel (PNG)
├── src/
│   ├── extension.ts            # Точка входа: activate(), PanelController
│   ├── types.ts                # Типы: TocNode, ParsedYamlLine, DocTreeItem
│   ├── tocParser.ts            # Парсер YAML-оглавления → TocNode[]
│   ├── treeDataProvider.ts     # TreeDataProvider для TreeView
│   ├── inputWebview.ts         # WebviewViewProvider для панели настроек
│   └── frontmatterReader.ts    # Чтение title, toc-tree-lvl, уровня заголовка из .md
├── build/                      # Сборочная система документации САКУРА (вне расширения)
│   └── ...
├── out/                        # Скомпилированный extension.js (git-ignored)
└── node_modules/               # Зависимости (git-ignored)
```

---

## 4. Ключевые типы

### TocNode (types.ts)

```typescript
interface TocNode {
  number?: string;            // Номер раздела "4.1.1"
  title: string;              // Титул из frontmatter или имя файла
  filePath: string;           // Относительный путь "user-manual/intro/scope.md"
  fullPath: string;           // Абсолютный путь
  children: TocNode[];        // Вложенные разделы
  parent?: TocNode;           // Родитель (для навигации)
  level: number;              // Уровень вложенности (по отступам YAML)
  tocTreeLvl?: number | '?';  // Уровень из аннотации (toc-tree-lvl=N)
}
```

### PanelConfig (extension.ts)

```typescript
interface PanelConfig {
  ns: string;                 // Пространство имён: 'docnav' | 'docnavDoppel'
  displayName: string;        // Отображаемое имя
  viewContainerId: string;    // ID view-контейнера
  webviewViewId: string;      // ID webview-панели
  treeViewId: string;         // ID tree-панели
}
```

---

## 5. Парсер YAML-оглавления (tocParser.ts)

### Формат `_contents.yaml`

```yaml
input-files:

  # (toc-tree-lvl=?) Аннотация
  - annotation.md
  # (toc-tree-lvl=1) 1 Глоссарий
  - glossary.md
  # (toc-tree-lvl=1) 2 Введение
  - introduction/_index.md
    # (toc-tree-lvl=2) 2.1 Область применения
  -   introduction/scope.md
```

### Алгоритм парсинга

1. **parseLine()** — разбирает строку в `ParsedYamlLine`, извлекает номер, toc-tree-lvl, флаги
2. **associateNumbers()** — связывает комментарии с номерами и toc-tree-lvl с файловыми записями
3. **adjustIndents()** — корректирует отступы записей по контексту комментариев
4. **buildTree()** — строит иерархию TocNode[] через стек
5. **inheritNumbers()** / **autoNumber()** — нумерация разделов

---

## 6. Frontmatter Reader (frontmatterReader.ts)

| Функция | Назначение |
|---|---|
| `readTitle()` | Извлекает `title` из frontmatter `.md`-файла |
| `readFirstHeadingLevel()` | Считает `#` первого заголовка после frontmatter (включая HTML-комментарии) |
| `readTocTreeLvlFromFrontmatter()` | Читает поле `toc-tree-lvl` из frontmatter (приоритетный источник) |
| `readAllTitles()` | Массовое чтение title для списка файлов |

### Алгоритм определения toc-tree-lvl (в `annotateTocLevelsInFile`)

1. **Аннотационные файлы** (имя содержит «annotation»/«аннотация») → всегда `'?'`
2. **Приоритет 1** — поле `toc-tree-lvl` в frontmatter → `readTocTreeLvlFromFrontmatter()`
3. **Приоритет 2** (fallback) — подсчёт `#` в первом заголовке → `readFirstHeadingLevel()`
4. Если ни один метод не дал результат → `'?'`

### Аннотирование комментариев в YAML (упрощено 2026-06-24)

Два случая:
- Комментарий **уже содержит** `(toc-tree-lvl=N)` → замена существующего значения
- Комментарий **без аннотации** → вставка `(toc-tree-lvl=N)` после `#` через `replace(/^(\s*#\s*)/, '$1(toc-tree-lvl=N) ')`

Старая трёхветочная логика со `splice` удалена как нестабильная.

---

## 7. Панель настроек (inputWebview.ts)

Webview с двумя полями ввода:
- **Файл оглавления** (`docnav.tocFilePath`) — относительный путь к YAML-файлу
- **Корневая директория** (`docnav.rootPath`) — директория-источник `.md`-файлов

При вводе текста — debounce 300ms → сохранение в `vscode.workspace.getConfiguration()`.  
При нажатии Enter — применение и перестроение дерева.

---

## 8. Команды расширения

| Команда | Назначение |
|---|---|
| `docnav.openFile` | Открыть `.md`-файл по клику в дереве |
| `docnav.refreshTree` | Обновить дерево |
| `docnav.expandAll` | Развернуть все узлы |
| `docnav.annotateTocLevels` | Прописать `(toc-tree-lvl=N)` в комментарии YAML |
| `docnav.syncTocNumbers` | Синхронизировать номера разделов с toc-tree-lvl |
| `docnav.openTocFile` | Открыть YAML-файл оглавления |
| `docnav.copyRelativePath` | Копировать относительный путь |
| `docnav.copyAbsolutePath` | Копировать абсолютный путь |

Все команды дублируются с префиксом `docnavDoppel` для второй панели.

### Активация расширения

```json
"activationEvents": [
  "onView:docnav.tocTree",
  "onView:docnavDoppel.tocTree"
]
```

Расширение активируется при открытии любой из панелей в Activity Bar.

---

## 9. Автообновление

- При сохранении YAML-файла оглавления → полная перестройка дерева
- При сохранении `.md`-файла (если он есть в дереве) → debounce 300ms → обновление title
- При смене активного редактора → подсветка текущего файла в дереве

---

## 10. Зависимости

| Пакет | Версия | Назначение |
|---|---|---|
| `gray-matter` | ^4.0.3 | Парсинг frontmatter (не используется напрямую — свой парсер) |
| `js-yaml` | ^4.1.0 | Парсинг YAML (не используется напрямую) |
| `esbuild` | ^0.20.0 | Сборка |
| `typescript` | ^5.3.0 | Компиляция |
| `@types/vscode` | ^1.85.0 | Типы VS Code API |
| `@vscode/vsce` | ^2.24.0 | Упаковка в .vsix |

---

## 11. Сборка и публикация

### Через скрипты в корне

```powershell
.\build.ps1            # Полная сборка + упаковка .vsix
.\build.ps1 compile    # Только компиляция
.\build.ps1 package    # Только упаковка
.\build.ps1 clean      # Очистить out/ и *.vsix
.\build.cmd             # То же самое, двойным кликом
```

### Через npm

```bash
npm run compile          # esbuild → out/extension.js
npm run watch            # esbuild --watch
npm run package          # vsce package → docnav-*.vsix
vsce publish             # Публикация в маркетплейс (требуется PAT)
```

### GitHub Actions CI/CD (`.github/workflows/ci.yml`)

- Триггеры: push в `main`/`dev`, pull request в `main`
- Шаги: checkout → Node.js 20 → `npm ci` → `npm run compile` → `vsce package` → артефакт

### Иконки

- **Activity Bar**: SVG (`media/icon.svg`) — поддерживает `currentColor` для адаптации к теме
- **Marketplace**: PNG 128×128 (`media/icon.png`) — сгенерирован из SVG через `sharp`

---

## 12. Конфигурация расширения

```jsonc
// В settings.json workspace
{
  "docnav.tocFilePath": "build/user-manual/_contents.yaml",
  "docnav.rootPath": "build/user-manual",
  "docnavDoppel.tocFilePath": "docs/_contents.yaml",
  "docnavDoppel.rootPath": "docs/user-manual/src"
}
```

---

## 13. Git

| Ветка | Назначение |
|---|---|
| `main` | Продакшн |
| `dev` | Разработка |
| `test1` | Текущая (тестовая) |

Remote: `origin → git@github.com:docs-with-deepseek/doc-nav-panel.git`

---

## 14. Примечания по доработке

1. **Точка входа** — `src/extension.ts::activate()` создаёт два `PanelController`. Обе панели всегда активны.
2. **Парсер YAML** — нестандартный формат с комментариями; несовместим с js-yaml/gray-matter напрямую. Весь парсинг в `tocParser.ts`.
3. **Frontmatter** — свой легковесный парсер в `frontmatterReader.ts` (не зависит от gray-matter). Поддерживает `title`, `toc-tree-lvl`.
4. **Определение toc-tree-lvl** — приоритет: annotation-файлы → `'?'`, затем frontmatter, затем первый заголовок `#`, затем `'?'`.
5. **Аннотирование YAML** — упрощено до двух веток (замена / вставка через regex replace). Старая логика со `splice` удалена.
6. **Иконки** — ThemeIcon: `folder`, `markdown`, `file`. Кастомные SVG/PNG — в `media/`.
7. **Webview** — HTML встроен в `inputWebview.ts::getHtml()`. При изменении учитывать CSP VS Code.
8. **VSIX-пакет** — исключения в `.vscodeignore`: `.vscode/`, `src/`, `node_modules/`, `.gitignore`, `tsconfig.json`, `esbuild.config.js`, `*.vsix`, `kilo.json`, `build/`, `build.ps1`, `build.cmd`.
9. **AI-контекст** — этот файл (`readme/ai-context.md`). Обновлять после каждого изменения расширения.

---

## История изменений

| Дата | Изменение |
|---|---|
| 2026-06-24 | Исходная версия: структура, архитектура, типы, сборка |
| 2026-06-24 | `readTocTreeLvlFromFrontmatter()` — приоритет frontmatter над подсчётом `#` |
| 2026-06-24 | GitHub Actions CI/CD, `LICENSE`, `README.md`, `.gitignore`/`.vscodeignore` |
| 2026-06-24 | Иконки PNG для marketplace (конвертация SVG → sharp), поле `icon` в package.json |
| 2026-06-24 | Скрипты сборки `build.ps1`/`build.cmd` в корне |
| 2026-06-24 | Упрощена логика аннотирования YAML: убран `splice`, оставлен `replace` |
| 2026-06-24 | Откат чекбокса DocNavDoppel — нестабильно, возврат к двум всегда видимым панелям |
