import { describe, expect, it, vi } from 'vitest'

import { KokoroVoiceCatalog } from './kokoro-voice-catalog'
import { KokoroVoiceListProvider } from './kokoro-voice-list-provider'

const BASE_URL = 'http://localhost:8880'

describe('KokoroVoiceListProvider', () => {
  it('normalizes the catalog reported by the local server', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      voices: [
        { id: 'zf_xiaoxiao', name: 'ignored' },
        { id: 'af_heart', name: 'ignored' },
        { id: 'not-a-kokoro-voice', name: 'ignored' }
      ]
    }), { status: 200 }))

    const voices = await new KokoroVoiceListProvider({ baseUrl: BASE_URL, fetch: fetchMock })
      .list()

    expect(voices).toEqual([
      { id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' },
      { id: 'zf_xiaoxiao', name: 'Xiaoxiao', locale: 'zh-CN', gender: 'Female' }
    ])
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_URL}/v1/audio/voices`)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit' })
  })

  it('accepts the legacy array of bare identifiers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ voices: ['bm_george'] }), { status: 200 })
    )

    await expect(new KokoroVoiceListProvider({ baseUrl: BASE_URL, fetch: fetchMock }).list())
      .resolves.toEqual([
        { id: 'bm_george', name: 'George', locale: 'en-GB', gender: 'Male' }
      ])
  })

  it('rejects a payload with no usable voice', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ voices: [] }), { status: 200 })
    )

    await expect(new KokoroVoiceListProvider({ baseUrl: BASE_URL, fetch: fetchMock }).list())
      .rejects.toThrow('invalid data')
  })
})

describe('KokoroVoiceCatalog', () => {
  it('reports the shipped catalog when the server is not running', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    const response = await new KokoroVoiceCatalog(BASE_URL, { fetch: fetchMock }).list()

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.source).toBe('fallback')
    expect(response.voices.some((voice) => voice.id === 'af_heart')).toBe(true)
  })

  it('prefers the voices the running server reports', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ voices: ['af_bella'] }), { status: 200 })
    )

    const response = await new KokoroVoiceCatalog(BASE_URL, { fetch: fetchMock }).list()

    expect(response).toEqual({
      ok: true,
      source: 'network',
      voices: [{ id: 'af_bella', name: 'Bella', locale: 'en-US', gender: 'Female' }]
    })
  })

  it('falls back instead of throwing on an unusable server address', async () => {
    const response = await new KokoroVoiceCatalog('not a url').list()

    expect(response).toMatchObject({ ok: true, source: 'fallback' })
  })
})
