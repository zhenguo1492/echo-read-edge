import { describe, expect, it } from 'vitest'

import { getLastWordRange } from './selection-panel-anchor'

describe('selection panel anchor', () => {
  it('focuses the final word across multiple sentences and inline nodes', () => {
    const paragraph = document.createElement('p')
    paragraph.append('Read the first sentence. Then choose the ')
    const emphasis = document.createElement('em')
    emphasis.textContent = 'final'
    paragraph.append(emphasis, ' word.')
    document.body.append(paragraph)

    const selection = document.createRange()
    selection.selectNodeContents(paragraph)

    expect(getLastWordRange(selection).toString()).toBe('word')
    paragraph.remove()
  })

  it('keeps apostrophes and hyphens inside the focused word', () => {
    const text = document.createTextNode("A well-known reader's choice")
    document.body.append(text)
    const selection = document.createRange()
    selection.setStart(text, 0)
    selection.setEnd(text, 21)

    expect(getLastWordRange(selection).toString()).toBe("reader's")
    text.remove()
  })

  it('falls back to the selection when it contains no word characters', () => {
    const text = document.createTextNode(' ... ')
    document.body.append(text)
    const selection = document.createRange()
    selection.selectNode(text)

    expect(getLastWordRange(selection).toString()).toBe(' ... ')
    text.remove()
  })
})
