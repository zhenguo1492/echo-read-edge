import { afterEach, describe, expect, it } from 'vitest'

import { collectPageTextSample } from './page-text-sample'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('page text sample', () => {
  it('collects the text of readable blocks in document order', () => {
    document.body.innerHTML = `
      <h1>Reading aloud</h1>
      <p>First paragraph.</p>
      <p>Second paragraph.</p>
    `

    expect(collectPageTextSample()).toBe(
      'Reading aloud First paragraph. Second paragraph.'
    )
  })

  it('prefers the main content over surrounding site chrome', () => {
    document.body.innerHTML = `
      <nav><a href="/">Navigation label</a></nav>
      <main><p>Article body.</p></main>
      <footer><p>Footer notice.</p></footer>
    `

    expect(collectPageTextSample()).toBe('Article body.')
  })

  it('drops site chrome when the page has no main region', () => {
    document.body.innerHTML = `
      <header><p>Header notice.</p></header>
      <p>Article body.</p>
      <footer><p>Footer notice.</p></footer>
    `

    expect(collectPageTextSample()).toBe('Article body.')
  })

  it('counts nested block text once', () => {
    document.body.innerHTML = '<li><p>Nested text.</p></li>'

    expect(collectPageTextSample()).toBe('Nested text.')
  })

  it('collapses whitespace so word counts stay meaningful', () => {
    document.body.innerHTML = '<p>  Spaced\n\n   out  </p>'

    expect(collectPageTextSample()).toBe('Spaced out')
  })

  it('stops at the requested budget instead of reading a whole long page', () => {
    document.body.innerHTML = `<p>${'word '.repeat(500)}</p>`

    expect(collectPageTextSample(40).length).toBeLessThanOrEqual(40)
  })

  it('falls back to the body when no readable block matched', () => {
    document.body.innerHTML = '<div><span>Loose text.</span></div>'

    expect(collectPageTextSample()).toBe('Loose text.')
  })

  it('reports an empty sample for a page without text', () => {
    expect(collectPageTextSample()).toBe('')
  })
})
