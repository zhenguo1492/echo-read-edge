/**
 * A Markdown renderer covering exactly the constructs the project documentation
 * uses: headings, paragraphs, bullet and numbered lists, fenced code, pipe
 * tables, and inline emphasis, code, and links.
 *
 * It exists so the help page can be generated at build time without pulling a
 * Markdown dependency into the extension. Every piece of source text is escaped
 * before it reaches the output, so a document can never inject markup into the
 * page that renders it.
 */

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/
const FENCE_PATTERN = /^```(\w*)\s*$/
const BULLET_PATTERN = /^[-*]\s+(.+)$/
const NUMBERED_PATTERN = /^\d+\.\s+(.+)$/
const CONTINUATION_PATTERN = /^\s+\S/
const TABLE_ROW_PATTERN = /^\|.*\|\s*$/
const TABLE_DIVIDER_PATTERN = /^\|[\s|:-]+\|\s*$/
const ABSOLUTE_URL_PATTERN = /^https?:\/\//

/** One rendered block plus the index of the first line after it. */
interface BlockResult {
  html: string
  next: number
}

/** Renders a Markdown document as the HTML body of the help page. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const usedHeadingIds = new Set<string>()
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    if (lines[index].trim() === '') {
      index += 1
      continue
    }

    const block = readBlock(lines, index, usedHeadingIds)
    blocks.push(block.html)
    index = block.next
  }

  return blocks.join('\n')
}

/** Dispatches to the reader for whichever block starts at `start`. */
function readBlock(
  lines: readonly string[],
  start: number,
  usedHeadingIds: Set<string>
): BlockResult {
  const line = lines[start]

  if (FENCE_PATTERN.test(line)) return readCodeBlock(lines, start)
  if (HEADING_PATTERN.test(line)) return readHeading(line, start, usedHeadingIds)
  if (isTableStart(lines, start)) return readTable(lines, start)
  if (BULLET_PATTERN.test(line)) return readList(lines, start, 'ul')
  if (NUMBERED_PATTERN.test(line)) return readList(lines, start, 'ol')

  return readParagraph(lines, start)
}

/** Reads a fenced block, whose content is never interpreted as Markdown. */
function readCodeBlock(lines: readonly string[], start: number): BlockResult {
  const language = FENCE_PATTERN.exec(lines[start])?.[1] ?? ''
  const content: string[] = []
  let index = start + 1

  while (index < lines.length && !FENCE_PATTERN.test(lines[index])) {
    content.push(lines[index])
    index += 1
  }

  const className = language === '' ? '' : ` class="language-${escapeAttribute(language)}"`

  return {
    html: `<pre><code${className}>${escapeHtml(content.join('\n'))}</code></pre>`,
    next: index + 1
  }
}

/** Reads an ATX heading and gives it an anchor other documents can link to. */
function readHeading(
  line: string,
  start: number,
  usedHeadingIds: Set<string>
): BlockResult {
  const [, hashes, text] = HEADING_PATTERN.exec(line) as RegExpExecArray
  const level = hashes.length
  const id = uniqueHeadingId(text, usedHeadingIds)

  return {
    html: `<h${level} id="${escapeAttribute(id)}">${renderInline(text)}</h${level}>`,
    next: start + 1
  }
}

/** Reads consecutive list items, folding each item's wrapped lines into it. */
function readList(
  lines: readonly string[],
  start: number,
  tag: 'ol' | 'ul'
): BlockResult {
  const itemPattern = tag === 'ul' ? BULLET_PATTERN : NUMBERED_PATTERN
  const items: string[] = []
  let index = start

  while (index < lines.length) {
    const itemMatch = itemPattern.exec(lines[index])
    if (itemMatch === null) break

    const parts = [itemMatch[1]]
    index += 1

    while (index < lines.length && CONTINUATION_PATTERN.test(lines[index])) {
      parts.push(lines[index].trim())
      index += 1
    }

    items.push(`<li>${renderInline(parts.join(' '))}</li>`)
  }

  return { html: `<${tag}>${items.join('')}</${tag}>`, next: index }
}

/** A pipe table is only a table when its second line is the divider row. */
function isTableStart(lines: readonly string[], start: number): boolean {
  return TABLE_ROW_PATTERN.test(lines[start])
    && start + 1 < lines.length
    && TABLE_DIVIDER_PATTERN.test(lines[start + 1])
}

/** Reads a pipe table, whose header row is fixed by the divider that follows. */
function readTable(lines: readonly string[], start: number): BlockResult {
  const headerCells = splitTableRow(lines[start])
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join('')
  const bodyRows: string[] = []
  let index = start + 2

  while (index < lines.length && TABLE_ROW_PATTERN.test(lines[index])) {
    const cells = splitTableRow(lines[index])
      .map((cell) => `<td>${renderInline(cell)}</td>`)
      .join('')
    bodyRows.push(`<tr>${cells}</tr>`)
    index += 1
  }

  return {
    html: `<table><thead><tr>${headerCells}</tr></thead>`
      + `<tbody>${bodyRows.join('')}</tbody></table>`,
    next: index
  }
}

/** Splits a table row into cells, keeping empty leading and trailing ones. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Reads a paragraph, whose soft-wrapped lines become one line of prose. */
function readParagraph(lines: readonly string[], start: number): BlockResult {
  const parts: string[] = []
  let index = start

  while (index < lines.length && !startsAnotherBlock(lines, index, index === start)) {
    parts.push(lines[index].trim())
    index += 1
  }

  return { html: `<p>${renderInline(parts.join(' '))}</p>`, next: index }
}

/** Reports whether the line at `index` ends the paragraph being collected. */
function startsAnotherBlock(
  lines: readonly string[],
  index: number,
  isFirstLine: boolean
): boolean {
  const line = lines[index]
  if (line.trim() === '') return true
  if (isFirstLine) return false

  return FENCE_PATTERN.test(line)
    || HEADING_PATTERN.test(line)
    || BULLET_PATTERN.test(line)
    || NUMBERED_PATTERN.test(line)
    || isTableStart(lines, index)
}

/**
 * Renders inline markup. Code spans are split out first so the emphasis and
 * link rules never rewrite what a span is meant to show verbatim.
 */
function renderInline(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((segment) => (
      segment.startsWith('`') && segment.endsWith('`') && segment.length > 1
        ? `<code>${escapeHtml(segment.slice(1, -1))}</code>`
        : renderInlineText(segment)
    ))
    .join('')
}

/** Renders the links and emphasis of one stretch of text outside code spans. */
function renderInlineText(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, target: string) => (
      ABSOLUTE_URL_PATTERN.test(target)
        ? `<a href="${escapeAttribute(target)}" target="_blank" `
          + `rel="noreferrer noopener">${label}</a>`
        // A repository-relative path has no page to open inside the extension,
        // so it is shown as the path it is instead of a dead link.
        : `<code>${label}</code>`
    ))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/** Builds a stable anchor for a heading, keeping repeated titles distinct. */
function uniqueHeadingId(text: string, usedHeadingIds: Set<string>): string {
  const base = text
    .toLowerCase()
    .replace(/`|\*\*|\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section'

  let id = base
  let suffix = 2

  while (usedHeadingIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }

  usedHeadingIds.add(id)

  return id
}

/** Escapes the characters that would otherwise start markup in the output. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escapes a value that is placed inside a double-quoted attribute. */
function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}
