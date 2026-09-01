/**
 * Selects one section of a Markdown document, so a page can show the part of
 * the documentation it is about rather than the whole file.
 */

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/
const FENCE_PATTERN = /^```/

/**
 * Returns the named heading together with everything nested under it, ending at
 * the next heading of the same or a higher level. Fenced code is skipped so a
 * shell comment inside an example never reads as a heading. Returns `null` when
 * the document has no such heading, which lets the caller fail loudly rather
 * than publish an empty page.
 */
export function extractSection(markdown: string, title: string): string | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const collected: string[] = []
  let sectionLevel = 0
  let isInsideFence = false

  for (const line of lines) {
    if (FENCE_PATTERN.test(line)) isInsideFence = !isInsideFence

    const heading = isInsideFence ? null : HEADING_PATTERN.exec(line)

    if (sectionLevel === 0) {
      if (heading !== null && heading[2] === title) {
        sectionLevel = heading[1].length
        collected.push(line)
      }
      continue
    }

    if (heading !== null && heading[1].length <= sectionLevel) break

    collected.push(line)
  }

  return sectionLevel === 0 ? null : collected.join('\n').trim()
}
