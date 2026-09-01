/** Page metadata captured when a reader saves a word they looked up. */
export interface WordContext {
  /** The sentence the word was read in, or undefined when none is recoverable. */
  context?: string
  sourceUrl?: string
  sourceTitle?: string
}

const BLOCK_TAG_NAMES = new Set([
  'p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'article', 'section', 'blockquote', 'figcaption', 'dd', 'dt'
])
const SENTENCE_END_SOURCE = '[.!?。！？](?:\\s|$)'
const MAX_CONTEXT_LENGTH = 500

/**
 * Captures the sentence surrounding a looked-up word so the vocabulary list can
 * show where the reader met it. Only the enclosing block is inspected, so a
 * saved context never grows with page length.
 */
export function captureWordContext(range: Range | null | undefined): WordContext {
  return {
    ...optional('context', range ? readSurroundingSentence(range) : undefined),
    ...optional('sourceUrl', readPageUrl()),
    ...optional('sourceTitle', document.title)
  }
}

function readSurroundingSentence(range: Range): string | undefined {
  const container = range.startContainer
  if (container.nodeType !== Node.TEXT_NODE) return undefined

  const block = findBlockAncestor(container as Text)
  if (!block) return undefined

  const blockText = block.textContent ?? ''
  const wordStart = absoluteOffsetOf(block, container as Text, range.startOffset)
  if (wordStart < 0) return undefined

  const wordEnd = wordStart + (range.toString().length || 1)
  const sentence = blockText
    .slice(sentenceStartBefore(blockText, wordStart), sentenceEndAfter(blockText, wordEnd))
    .replace(/\s+/gu, ' ')
    .trim()

  if (!sentence) return undefined
  return sentence.length > MAX_CONTEXT_LENGTH
    ? sentence.slice(0, MAX_CONTEXT_LENGTH).trimEnd()
    : sentence
}

function findBlockAncestor(node: Text): Element | null {
  let element = node.parentElement
  while (element && element !== document.body) {
    if (BLOCK_TAG_NAMES.has(element.tagName.toLowerCase())) return element
    element = element.parentElement
  }
  return node.parentElement
}

/**
 * Returns -1 when the text node is not part of the block that was resolved.
 * The block is walked directly so the offset matches its own textContent, which
 * is what the sentence boundaries are measured against.
 */
function absoluteOffsetOf(block: Element, node: Text, offsetInNode: number): number {
  let offset = 0

  function visit(current: Node): boolean {
    if (current === node) {
      offset += offsetInNode
      return true
    }
    if (current.nodeType === Node.TEXT_NODE) {
      offset += (current as Text).data.length
      return false
    }
    for (const child of current.childNodes) {
      if (visit(child)) return true
    }
    return false
  }

  return visit(block) ? offset : -1
}

function sentenceStartBefore(text: string, wordStart: number): number {
  let start = 0
  for (const end of sentenceEndings(text)) {
    if (end > wordStart) break
    start = end
  }
  return start
}

function sentenceEndAfter(text: string, wordEnd: number): number {
  for (const end of sentenceEndings(text)) {
    if (end >= wordEnd) return end
  }
  return text.length
}

function sentenceEndings(text: string): number[] {
  const endings: number[] = []
  // A fresh matcher per call keeps lastIndex out of module state.
  const pattern = new RegExp(SENTENCE_END_SOURCE, 'gu')
  let match = pattern.exec(text)
  while (match) {
    endings.push(match.index + 1)
    match = pattern.exec(text)
  }
  return endings
}

/** Only web pages become a source record; local and extension pages do not. */
function readPageUrl(): string | undefined {
  const url = window.location.href
  return /^https?:\/\//u.test(url) ? url : undefined
}

function optional<K extends string>(
  key: K,
  value: string | undefined
): Record<K, string> | Record<string, never> {
  const trimmed = value?.trim()
  return trimmed ? ({ [key]: trimmed } as Record<K, string>) : {}
}
