import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FreeDictionaryProvider,
  normalizeFreeDictionaryEntry
} from './free-dictionary-provider'

afterEach(() => vi.unstubAllGlobals())

describe('FreeDictionaryProvider', () => {
  it('normalizes phonetics, meanings, examples, and synonyms across homographs', () => {
    const entry = normalizeFreeDictionaryEntry(createFreeDictionaryPayload(), 'read')

    expect(entry).toMatchObject({
      word: 'read',
      ukPhonetic: '/riːd/',
      usPhonetic: '/ɹiˈid/',
      phonetic: '/riːd/',
      collins: [],
      phrases: [],
      discriminate: []
    })
    expect(entry?.ukSpeech).toBe('https://api.dictionaryapi.dev/media/pronunciations/en/read-uk.mp3')
    expect(entry?.usSpeech).toBe('https://ssl.gstatic.com/dictionary/static/sounds/read--_us_1.mp3')
    expect(entry?.meanings).toEqual([
      { partOfSpeech: 'verb', definition: 'To look at and interpret written words.' },
      { partOfSpeech: 'verb', definition: 'To speak aloud from a text.' },
      { partOfSpeech: 'noun', definition: 'A period of reading.' }
    ])
    expect(entry?.examples).toEqual([
      { en: 'She read the letter twice.', zh: '', source: 'free-dictionary' },
      { en: 'He read the notice to the class.', zh: '', source: 'free-dictionary' }
    ])
    expect(entry?.synonyms).toEqual([
      { pos: 'verb', meaning: '', words: ['peruse', 'study', 'scan'] }
    ])
  })

  it('rejects an entry that carries no usable definition', () => {
    expect(normalizeFreeDictionaryEntry([{ word: 'read', meanings: [] }], 'read')).toBeNull()
    expect(normalizeFreeDictionaryEntry({ title: 'No Definitions Found' }, 'read')).toBeNull()
  })

  it('validates input and calls only the fixed Free Dictionary endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(createFreeDictionaryPayload()),
      { status: 200 }
    ))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FreeDictionaryProvider()

    expect(provider.name).toBe('free-dictionary')
    expect(provider.definitionLanguage).toBe('en')

    await expect(provider.lookup('../read', new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-word' })
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(provider.lookup('Read', new AbortController().signal))
      .resolves.toMatchObject({ word: 'read' })
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requestedUrl.origin).toBe('https://api.dictionaryapi.dev')
    expect(requestedUrl.pathname).toBe('/api/v2/entries/en/read')
  })

  it('reports a missing word apart from an unavailable service', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FreeDictionaryProvider()

    await expect(provider.lookup('read', new AbortController().signal))
      .rejects.toMatchObject({ code: 'not-found' })
    await expect(provider.lookup('read', new AbortController().signal))
      .rejects.toMatchObject({ code: 'unavailable' })
    await expect(provider.lookup('read', new AbortController().signal))
      .rejects.toMatchObject({ code: 'unavailable' })
  })
})

function createFreeDictionaryPayload(): unknown {
  return [
    {
      word: 'read',
      phonetic: '/riːd/',
      phonetics: [
        { text: '/riːd/', audio: '' },
        {
          text: '/riːd/',
          audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/read-uk.mp3'
        },
        {
          text: '/ɹiˈid/',
          audio: '//ssl.gstatic.com/dictionary/static/sounds/read--_us_1.mp3'
        }
      ],
      meanings: [
        {
          partOfSpeech: 'verb',
          definitions: [
            {
              definition: 'To look at and interpret written words.',
              example: 'She read the letter twice.',
              synonyms: ['peruse']
            },
            {
              definition: 'To speak aloud from a text.',
              example: 'He read the notice to the class.'
            }
          ],
          synonyms: ['study', 'scan', 'peruse']
        }
      ]
    },
    {
      word: 'read',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [{ definition: 'A period of reading.' }]
        }
      ]
    }
  ]
}
