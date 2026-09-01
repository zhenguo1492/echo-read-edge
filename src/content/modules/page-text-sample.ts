/**
 * Blocks that hold a page's prose. Detection needs sentences, so headings,
 * paragraphs, and list items are read while the boxes that merely arrange them
 * are not.
 */
const READABLE_BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, dd, td'

/** Regions that surround an article rather than belong to it. */
const SITE_CHROME_SELECTOR = 'nav, header, footer, aside'

const MAIN_CONTENT_SELECTOR = 'main, article, [role="main"]'

/** Enough prose to name a language, far less than a page can hold. */
export const PAGE_TEXT_SAMPLE_LENGTH = 2000

/**
 * Returns a bounded sample of the prose a reader came to the page for.
 *
 * A language verdict is only as good as the text behind it, and a page's
 * navigation, cookie banner, and footer are frequently written in a different
 * language from its article. So the article is preferred where the page marks
 * one, site chrome is left out where it does not, and the whole body answers
 * only when nothing else did.
 */
export function collectPageTextSample(limit = PAGE_TEXT_SAMPLE_LENGTH): string {
  const root = document.querySelector(MAIN_CONTENT_SELECTOR) ?? document.body
  if (!root) return ''

  const sample = collectBlockText(root, root === document.body, limit)
  return sample || normalizeWhitespace(root.textContent ?? '').slice(0, limit)
}

function collectBlockText(
  root: Element,
  excludeSiteChrome: boolean,
  limit: number
): string {
  const parts: string[] = []
  let length = 0

  for (const block of root.querySelectorAll(READABLE_BLOCK_SELECTOR)) {
    // An outer block's text is its inner blocks' text, so only the innermost
    // one contributes and no passage is weighed twice.
    if (block.querySelector(READABLE_BLOCK_SELECTOR)) continue
    if (excludeSiteChrome && block.closest(SITE_CHROME_SELECTOR)) continue

    const text = normalizeWhitespace(block.textContent ?? '')
    if (!text) continue

    parts.push(text)
    length += text.length + 1
    if (length >= limit) break
  }

  return parts.join(' ').slice(0, limit)
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
