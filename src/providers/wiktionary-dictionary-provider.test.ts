import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  WiktionaryDictionaryProvider,
  normalizeWiktionaryEntry
} from './wiktionary-dictionary-provider'

afterEach(() => vi.unstubAllGlobals())

describe('WiktionaryDictionaryProvider', () => {
  it('normalizes the English sections into meanings and examples', () => {
    const entry = normalizeWiktionaryEntry(createWiktionaryPayload(), 'interesting')

    expect(entry).toMatchObject({
      word: 'interesting',
      collins: [],
      phrases: [],
      discriminate: [],
      synonyms: []
    })
    expect(entry?.meanings).toEqual([
      { partOfSpeech: 'adjective', definition: 'Of concern; affecting, important.' },
      {
        partOfSpeech: 'adjective',
        definition: 'Arousing or holding the attention or interest of someone.'
      },
      { partOfSpeech: 'noun', definition: 'Something that "interests".' }
    ])
    expect(entry?.examples).toEqual([
      { en: 'Cricket is not interesting to watch.', zh: '', source: 'wiktionary' }
    ])
  })

  it('ignores sections written in another language and markup-only definitions', () => {
    const entry = normalizeWiktionaryEntry({
      fr: [{ partOfSpeech: 'Nom', definitions: [{ definition: 'Un mot.' }] }],
      en: [{
        partOfSpeech: 'Verb',
        definitions: [
          { definition: '<span class="usage-label-sense"></span>' },
          { definition: 'To hold attention.' }
        ]
      }]
    }, 'interest')

    expect(entry?.meanings).toEqual([
      { partOfSpeech: 'verb', definition: 'To hold attention.' }
    ])
  })

  it('drops the stylesheet Wiktionary embeds inside a definition', () => {
    const entry = normalizeWiktionaryEntry({
      en: [{
        partOfSpeech: 'Adjective',
        definitions: [{
          definition: 'Pregnant.<style data-mw-deduplicate="x">.mw-parser-output'
            + ' .defdate{font-size:smaller}</style>'
        }]
      }]
    }, 'interesting')

    expect(entry?.meanings).toEqual([
      { partOfSpeech: 'adjective', definition: 'Pregnant.' }
    ])
  })

  it('reads the lemma from a page that only records inflected forms', () => {
    const entry = normalizeWiktionaryEntry({
      en: [{
        partOfSpeech: 'Numeral',
        definitions: [{ definition: '<a href="/wiki/plural">plural</a> of billion' }]
      }]
    }, 'billions')

    expect(entry?.lemma).toBe('billion')
    expect(entry?.meanings).toEqual([
      { partOfSpeech: 'numeral', definition: 'plural of billion' }
    ])
  })

  it('keeps a page with senses of its own off the lemma path', () => {
    const entry = normalizeWiktionaryEntry({
      en: [
        {
          partOfSpeech: 'Adjective',
          definitions: [{ definition: 'Arousing attention.' }]
        },
        {
          partOfSpeech: 'Verb',
          definitions: [{ definition: 'present participle and gerund of interest' }]
        }
      ]
    }, 'interesting')

    expect(entry?.lemma).toBeUndefined()
  })

  it('rejects a payload with no English definition', () => {
    expect(normalizeWiktionaryEntry({ fr: [] }, 'interest')).toBeNull()
    expect(normalizeWiktionaryEntry({ en: [{ partOfSpeech: 'Noun', definitions: [] }] }, 'x'))
      .toBeNull()
  })

  it('validates input and calls only the fixed Wiktionary endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(createWiktionaryPayload()),
      { status: 200 }
    ))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new WiktionaryDictionaryProvider()

    expect(provider.name).toBe('wiktionary')
    expect(provider.definitionLanguage).toBe('en')

    await expect(provider.lookup('../interesting', new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-word' })
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(provider.lookup('Interesting', new AbortController().signal))
      .resolves.toMatchObject({ word: 'interesting' })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://en.wiktionary.org/api/rest_v1/page/definition/interesting'
    )
  })

  it('reports a missing page as not found and any other failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(new WiktionaryDictionaryProvider().lookup('zzzz', new AbortController().signal))
      .rejects.toMatchObject({ code: 'not-found' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(new WiktionaryDictionaryProvider().lookup('read', new AbortController().signal))
      .rejects.toMatchObject({ code: 'unavailable' })
  })
})

function createWiktionaryPayload(): unknown {
  return {
    en: [
      {
        partOfSpeech: 'Adjective',
        language: 'English',
        definitions: [
          {
            definition:
              '<span class="usage-label-sense"></span> Of <a href="/wiki/concern">concern</a>;'
              + ' <a href="/wiki/affecting">affecting</a>, important.'
          },
          {
            definition: 'Arousing or holding the attention or interest of someone.',
            examples: ['<i>Cricket is not <b>interesting</b> to watch</i>.']
          }
        ]
      },
      {
        partOfSpeech: 'Noun',
        language: 'English',
        definitions: [{ definition: 'Something that &quot;interests&quot;.' }]
      }
    ]
  }
}
