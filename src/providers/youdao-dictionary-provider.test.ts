import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  YoudaoDictionaryProvider,
  normalizeYoudaoDictionaryEntry
} from './youdao-dictionary-provider'

afterEach(() => vi.unstubAllGlobals())

describe('YoudaoDictionaryProvider', () => {
  it('ports the legacy meanings, Collins, examples, synonyms, and phrases', () => {
    const entry = normalizeYoudaoDictionaryEntry(createYoudaoPayload(), 'reading')

    expect(entry).toMatchObject({
      word: 'reading',
      lemma: 'read',
      ukPhonetic: '/riːdɪŋ/',
      usPhonetic: '/riːdɪŋ/',
      forms: 'past: read',
      collinsStar: 4,
      level: 'CET4',
      meanings: [{ partOfSpeech: 'n.', definition: '阅读' }],
      synonyms: [{ pos: 'n.', meaning: '阅读', words: ['study', 'interpretation'] }],
      phrases: [{ phrase: 'reading room', meaning: '阅览室' }],
      discriminate: [{ word: 'read', usage: '强调理解文字' }]
    })
    expect(entry?.collins[0]).toEqual({
      pos: 'N-UNCOUNT',
      posTips: 'uncountable noun',
      definition: 'Reading is the activity of reading books.',
      examples: [{ en: 'Reading is useful.', zh: '阅读很有用。' }]
    })
    expect(entry?.examples).toEqual([
      { en: 'Reading is useful.', zh: '阅读很有用。', source: 'collins' },
      { en: 'I enjoy reading.', zh: '我喜欢阅读。', source: 'bilingual' }
    ])
    expect(entry?.ukSpeech).toContain('https://dict.youdao.com/dictvoice?audio=uk-reading')
  })

  it('validates input and calls only the fixed Youdao endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(createYoudaoPayload()),
      { status: 200 }
    ))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new YoudaoDictionaryProvider()

    await expect(provider.lookup('../read', new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-word' })
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(provider.lookup('Reading', new AbortController().signal))
      .resolves.toMatchObject({ word: 'reading' })
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requestedUrl.origin).toBe('https://dict.youdao.com')
    expect(requestedUrl.pathname).toBe('/jsonapi')
    expect(requestedUrl.searchParams.get('q')).toBe('reading')
  })
})

function createYoudaoPayload(): unknown {
  return {
    ec: {
      exam_type: ['CET4'],
      word: [{
        prototype: 'read',
        ukphone: 'riːdɪŋ',
        usphone: 'riːdɪŋ',
        ukspeech: 'uk-reading',
        usspeech: 'us-reading',
        wfs: [{ wf: { name: 'past', value: 'read' } }],
        trs: [{ tr: [{ l: { i: ['n. 阅读'] } }] }]
      }]
    },
    collins: {
      collins_entries: [{
        star: '4',
        basic_entries: { basic_entry: [{ cet: 'CET4' }] },
        entries: { entry: [{ tran_entry: [{
          pos_entry: { pos: 'N-UNCOUNT', pos_tips: 'uncountable noun' },
          tran: '<b>Reading</b> is the activity of reading books.',
          exam_sents: { sent: [{ eng_sent: 'Reading is useful.', chn_sent: '阅读很有用。' }] }
        }] }] }
      }]
    },
    blng_sents_part: {
      'sentence-pair': [{ sentence: 'I enjoy <b>reading</b>.', 'sentence-translation': '我喜欢阅读。' }]
    },
    syno: { synos: [{ syno: { pos: 'n.', tran: '阅读', ws: [{ w: 'study' }, { w: 'interpretation' }] } }] },
    discriminate: { data: [{ usages: [{ headword: 'read', usage: '强调理解文字' }] }] },
    phrs: { phrs: [{ phr: { headword: { l: { i: 'reading room' } }, trs: [{ tr: { l: { i: '阅览室' } } }] } }] }
  }
}
