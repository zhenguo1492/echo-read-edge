import { afterEach, describe, expect, it } from 'vitest'

import { captureWordContext } from './word-context'

afterEach(() => {
  document.body.innerHTML = ''
})

function selectWord(html: string, word: string): Range {
  document.body.innerHTML = html
  const paragraph = document.body.querySelector('p, div')!
  for (const node of collectTextNodes(paragraph)) {
    const index = node.data.indexOf(word)
    if (index < 0) continue
    const range = document.createRange()
    range.setStart(node, index)
    range.setEnd(node, index + word.length)
    return range
  }
  throw new Error(`Missing test word: ${word}`)
}

function collectTextNodes(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) return [root as Text]
  return [...root.childNodes].flatMap(collectTextNodes)
}

describe('captureWordContext', () => {
  it('captures only the sentence the word was read in', () => {
    const range = selectWord(
      '<p>Nothing here yet. The city proved resilient after the storm. A later sentence.</p>',
      'resilient'
    )

    expect(captureWordContext(range).context)
      .toBe('The city proved resilient after the storm.')
  })

  it('joins inline markup and collapses whitespace inside one sentence', () => {
    const range = selectWord(
      '<p>The city\n  proved <em>resilient</em> after the storm.</p>',
      'resilient'
    )

    expect(captureWordContext(range).context)
      .toBe('The city proved resilient after the storm.')
  })

  it('stops at the enclosing block instead of reading the whole page', () => {
    document.body.innerHTML =
      '<div><p>Earlier block.</p><p>A resilient reply</p><p>Later block.</p></div>'
    const target = document.body.querySelectorAll('p')[1].firstChild as Text
    const range = document.createRange()
    range.setStart(target, 2)
    range.setEnd(target, 11)

    expect(captureWordContext(range).context).toBe('A resilient reply')
  })

  it('truncates a block that has no sentence punctuation', () => {
    const range = selectWord(`<p>resilient ${'word '.repeat(200)}</p>`, 'resilient')

    const captured = captureWordContext(range).context!
    expect(captured.length).toBeLessThanOrEqual(500)
    expect(captured.length).toBeGreaterThan(490)
    expect(captured.startsWith('resilient word')).toBe(true)
  })

  it('records the page title and reports no context without a text range', () => {
    document.title = 'A resilient city'

    const captured = captureWordContext(null)

    expect(captured.sourceTitle).toBe('A resilient city')
    expect(captured.context).toBeUndefined()
  })
})
