import { describe, expect, it } from 'vitest'

import { renderHelpDocument } from './help-document'

describe('renderHelpDocument', () => {
  it('wraps the rendered Markdown in a standalone document', () => {
    const html = renderHelpDocument('## Speech engines\n\nPick one.')

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<h2 id="speech-engines">Speech engines</h2>')
    expect(html).toContain('<p>Pick one.</p>')
  })

  it('titles the page after the document heading when it has one', () => {
    expect(renderHelpDocument('# EchoRead Edge\n\nIntro.')).toContain(
      '<title>EchoRead Edge</title>'
    )
  })

  it('falls back to a generic title when the document has no heading', () => {
    expect(renderHelpDocument('Intro.')).toContain('<title>EchoRead Edge help</title>')
  })

  it('styles the page from an inline sheet so it needs no other file', () => {
    const html = renderHelpDocument('# Title')

    expect(html).toContain('<style>')
    expect(html).not.toContain('<script')
  })
})
