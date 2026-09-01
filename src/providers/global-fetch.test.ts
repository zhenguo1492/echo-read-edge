import { afterEach, describe, expect, it, vi } from 'vitest'

import { EdgeVoiceListProvider } from './edge-voice-list-provider'
import { resolveFetch } from './global-fetch'
import { KokoroTtsProvider } from './kokoro-tts-provider'
import { KokoroVoiceListProvider } from './kokoro-voice-list-provider'

/**
 * Chrome refuses a fetch whose receiver is not the global object. Node and
 * happy-dom accept any receiver, so this stub is the only way a test can notice
 * a Provider that captured the bare global on an instance field.
 */
function installBrandCheckedFetch(respond: () => Response): () => unknown[] {
  const receivers: unknown[] = []
  const brandChecked = function (this: unknown): Promise<Response> {
    receivers.push(this)
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(
        new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      )
    }
    return Promise.resolve(respond())
  }
  vi.stubGlobal('fetch', brandChecked)
  return () => receivers
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveFetch', () => {
  it('returns the injected fetch untouched', () => {
    const injected = vi.fn<typeof fetch>()
    expect(resolveFetch(injected)).toBe(injected)
  })

  it('binds the global so a non-global receiver cannot reach it', async () => {
    const receivers = installBrandCheckedFetch(() => new Response('ok', { status: 200 }))
    const holder = { call: resolveFetch() }

    await expect(holder.call('https://example.test/')).resolves.toMatchObject({ status: 200 })
    expect(receivers()).toEqual([globalThis])
  })
})

describe('providers that default to the global fetch', () => {
  it('lets the Kokoro catalog reach a brand-checking runtime', async () => {
    installBrandCheckedFetch(() => new Response(
      JSON.stringify({ voices: [{ id: 'af_heart', name: 'af_heart' }] }),
      { status: 200 }
    ))

    await expect(new KokoroVoiceListProvider().list()).resolves.toEqual([
      { id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' }
    ])
  })

  it('lets Kokoro synthesis reach a brand-checking runtime', async () => {
    const chunk = JSON.stringify({
      audio: btoa(String.fromCharCode(1, 2, 3)),
      audio_format: 'audio/mpeg',
      timestamps: [{ word: 'Hi', start_time: 0, end_time: 0.2 }]
    })
    installBrandCheckedFetch(() => new Response(`${chunk}\n`, { status: 200 }))

    const result = await new KokoroTtsProvider().synthesize(
      { text: 'Hi', voice: 'af_heart', rate: 1 },
      new AbortController().signal
    )

    expect(result.audio.byteLength).toBe(3)
    expect(result.wordBoundaries).toEqual([{ word: 'Hi', startTime: 0, endTime: 0.2 }])
  })

  it('lets the Edge catalog reach a brand-checking runtime', async () => {
    installBrandCheckedFetch(() => new Response(
      JSON.stringify([{ ShortName: 'en-US-AriaNeural', Locale: 'en-US', Gender: 'Female' }]),
      { status: 200 }
    ))

    await expect(new EdgeVoiceListProvider().list()).resolves.toEqual([
      { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' }
    ])
  })
})
