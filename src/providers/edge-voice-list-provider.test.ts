import { describe, expect, it, vi } from 'vitest'

import { EdgeVoiceListProvider } from './edge-voice-list-provider'

describe('EdgeVoiceListProvider', () => {
  it('fetches and normalizes the keyless Edge Read Aloud catalog', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      {
        ShortName: 'en-US-AriaNeural',
        Locale: 'en-US',
        Gender: 'Female',
        FriendlyName: 'ignored'
      },
      {
        ShortName: 'zh-CN-liaoning-XiaobeiNeural',
        Locale: 'zh-CN-liaoning',
        Gender: 'Female'
      },
      { ShortName: 'javascript:invalid', Locale: 'en-US', Gender: 'Male' }
    ]), { status: 200 }))
    const provider = new EdgeVoiceListProvider({ fetch: fetchMock })

    const voices = await provider.list()

    expect(voices).toEqual([
      { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' },
      {
        id: 'zh-CN-liaoning-XiaobeiNeural',
        name: 'Xiaobei',
        locale: 'zh-CN-liaoning',
        gender: 'Female'
      }
    ])
    const requestedUrl = String(fetchMock.mock.calls[0][0])
    expect(requestedUrl).toContain('/readaloud/voices/list?trustedclienttoken=')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'omit'
    })
  })

  it('rejects an unusable upstream payload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ voices: [] }), { status: 200 })
    )

    await expect(new EdgeVoiceListProvider({ fetch: fetchMock }).list())
      .rejects.toThrow('invalid data')
  })
})
