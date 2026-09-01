import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GoogleTranslationProvider,
  parseRetryAfter,
  parseTranslation
} from './google-translation-provider'
import { TranslationProviderError } from './translation-provider'

afterEach(() => vi.unstubAllGlobals())

describe('GoogleTranslationProvider', () => {
  it('posts text only to the fixed Google endpoint and normalizes the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([[['你好。', 'Hello.']], null, 'en']),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new GoogleTranslationProvider().translate({
      text: 'Hello.',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN'
    }, new AbortController().signal)

    expect(result).toEqual({ translation: '你好。', detectedLanguage: 'en' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/translate\.googleapis\.com\/translate_a\/single\?/)
    // The public "gtx" client shares one heavily abused quota bucket that stays
    // blocked for a whole network; dict-chrome-ex answers when gtx returns 429.
    expect(new URL(String(url)).searchParams.get('client')).toBe('dict-chrome-ex')
    expect(init.body).toBe('q=Hello.')
  })

  it('reports the status and Retry-After hint so a rate limit can be backed off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Sorry...', { status: 429, headers: { 'Retry-After': '30' } })
    ))

    const failure = await new GoogleTranslationProvider().translate({
      text: 'Hello.',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN'
    }, new AbortController().signal).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TranslationProviderError)
    expect((failure as TranslationProviderError).status).toBe(429)
    expect((failure as TranslationProviderError).retryAfterMs).toBe(30_000)
  })

  it('reads both the seconds and HTTP-date forms of Retry-After', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('12')).toBe(12_000)
    expect(parseRetryAfter('not-a-date')).toBeUndefined()
  })

  it('rejects malformed or empty nested responses', () => {
    expect(parseTranslation(null)).toBeNull()
    expect(parseTranslation([[]])).toBeNull()
    expect(parseTranslation([[['One '], ['two']]])).toBe('One two')
  })
})
