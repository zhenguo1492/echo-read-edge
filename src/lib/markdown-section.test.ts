import { describe, expect, it } from 'vitest'

import { extractSection } from './markdown-section'

describe('extractSection', () => {
  it('keeps the named section and everything nested under it', () => {
    const markdown = [
      '# Title',
      '',
      'Intro.',
      '',
      '## Speech engines',
      '',
      'Two engines.',
      '',
      '### Kokoro',
      '',
      'Local.',
      '',
      '## Development',
      '',
      'Not part of it.'
    ].join('\n')

    expect(extractSection(markdown, 'Speech engines')).toBe(
      '## Speech engines\n\nTwo engines.\n\n### Kokoro\n\nLocal.'
    )
  })

  it('stops at a heading above the section as well', () => {
    const markdown = [
      '## Speech engines',
      '',
      'Two engines.',
      '',
      '# Another document',
      '',
      'Gone.'
    ].join('\n')

    expect(extractSection(markdown, 'Speech engines')).toBe('## Speech engines\n\nTwo engines.')
  })

  it('runs to the end of the document when no later heading closes it', () => {
    const markdown = '## Speech engines\n\nTwo engines.\n'

    expect(extractSection(markdown, 'Speech engines')).toBe('## Speech engines\n\nTwo engines.')
  })

  it('ignores a hash line inside a fenced code block', () => {
    const markdown = [
      '## Speech engines',
      '',
      '```sh',
      '# Development',
      'docker compose up -d',
      '```',
      '',
      'After the block.',
      '',
      '## Development',
      '',
      'Gone.'
    ].join('\n')

    expect(extractSection(markdown, 'Speech engines')).toBe(
      '## Speech engines\n\n```sh\n# Development\ndocker compose up -d\n```\n\nAfter the block.'
    )
  })

  it('reports a missing section instead of returning an empty document', () => {
    expect(extractSection('# Title\n\nIntro.', 'Speech engines')).toBeNull()
  })
})
