import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders headings with anchors derived from their text', () => {
    expect(renderMarkdown('## Speech engines')).toBe(
      '<h2 id="speech-engines">Speech engines</h2>'
    )
  })

  it('joins the soft-wrapped lines of a paragraph', () => {
    expect(renderMarkdown('EchoRead Edge is a\nChrome extension.')).toBe(
      '<p>EchoRead Edge is a Chrome extension.</p>'
    )
  })

  it('renders bold, italic, and inline code', () => {
    expect(renderMarkdown('Open **Settings** in the *popup* with `yarn dev`.')).toBe(
      '<p>Open <strong>Settings</strong> in the <em>popup</em> with '
      + '<code>yarn dev</code>.</p>'
    )
  })

  it('leaves markup inside an inline code span alone', () => {
    expect(renderMarkdown('Run `a **b** c`.')).toBe(
      '<p>Run <code>a **b** c</code>.</p>'
    )
  })

  it('escapes HTML so README text can never inject markup', () => {
    expect(renderMarkdown('A <script>alert(1)</script> & more')).toBe(
      '<p>A &lt;script&gt;alert(1)&lt;/script&gt; &amp; more</p>'
    )
  })

  it('links absolute URLs in a new tab and keeps repository paths as text', () => {
    expect(renderMarkdown('See [the guide](https://example.com/g).')).toBe(
      '<p>See <a href="https://example.com/g" target="_blank" '
      + 'rel="noreferrer noopener">the guide</a>.</p>'
    )
    expect(renderMarkdown('See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).')).toBe(
      '<p>See <code>docs/ARCHITECTURE.md</code>.</p>'
    )
  })

  it('renders a fenced code block without interpreting its content', () => {
    expect(renderMarkdown('```sh\ndocker compose up -d   # <CPU>\n```')).toBe(
      '<pre><code class="language-sh">docker compose up -d   # &lt;CPU&gt;</code></pre>'
    )
  })

  it('collects bullet items and folds their continuation lines in', () => {
    const markdown = [
      '- **Read a page aloud** sentence',
      '  by sentence.',
      '- Second item.'
    ].join('\n')

    expect(renderMarkdown(markdown)).toBe(
      '<ul><li><strong>Read a page aloud</strong> sentence by sentence.</li>'
      + '<li>Second item.</li></ul>'
    )
  })

  it('renders numbered items as an ordered list', () => {
    const markdown = [
      '1. Open `chrome://extensions`.',
      '2. Turn on Developer mode,',
      '   top right.'
    ].join('\n')

    expect(renderMarkdown(markdown)).toBe(
      '<ol><li>Open <code>chrome://extensions</code>.</li>'
      + '<li>Turn on Developer mode, top right.</li></ol>'
    )
  })

  it('renders a pipe table with its header row', () => {
    const markdown = [
      '| Host | GPU profile |',
      '| --- | --- |',
      '| Linux | Yes |'
    ].join('\n')

    expect(renderMarkdown(markdown)).toBe(
      '<table><thead><tr><th>Host</th><th>GPU profile</th></tr></thead>'
      + '<tbody><tr><td>Linux</td><td>Yes</td></tr></tbody></table>'
    )
  })

  it('keeps an empty leading table heading cell', () => {
    const markdown = [
      '| | Kokoro | Edge |',
      '| --- | --- | --- |',
      '| Runs | Docker | Microsoft |'
    ].join('\n')

    expect(renderMarkdown(markdown)).toContain(
      '<tr><th></th><th>Kokoro</th><th>Edge</th></tr>'
    )
  })

  it('separates blocks that follow one another', () => {
    const markdown = [
      '# Title',
      '',
      'A paragraph.',
      '',
      '- An item',
      '',
      'Another paragraph.'
    ].join('\n')

    expect(renderMarkdown(markdown)).toBe(
      '<h1 id="title">Title</h1>\n'
      + '<p>A paragraph.</p>\n'
      + '<ul><li>An item</li></ul>\n'
      + '<p>Another paragraph.</p>'
    )
  })

  it('returns nothing for empty input', () => {
    expect(renderMarkdown('   \n\n')).toBe('')
  })
})
