import { describe, expect, it, vi } from 'vitest'

import { KokoroTtsProvider } from './kokoro-tts-provider'
import type { SpeechAudioChunk, TtsProviderError, WordBoundary } from './tts-provider'

const BASE_URL = 'http://localhost:8880'

describe('KokoroTtsProvider', () => {
  it('streams decoded audio and word timings from the captioned route', async () => {
    const fetchMock = createFetchMock([
      {
        audio: encodeAudio([1, 2, 3]),
        audio_format: 'mp3',
        timestamps: [{ word: 'Hello', start_time: 0, end_time: 0.45 }]
      },
      {
        audio: encodeAudio([4, 5]),
        audio_format: 'mp3',
        timestamps: [{ word: 'world', start_time: 0.45, end_time: 0.8, voice: 'af_heart' }]
      }
    ])
    const provider = new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: fetchMock })
    const chunks: SpeechAudioChunk[] = []
    const boundaries: WordBoundary[] = []

    const summary = await provider.synthesizeStream(
      { text: 'Hello world', voice: 'af_heart', rate: 1.2 },
      {
        onAudioChunk: (chunk) => chunks.push(chunk),
        onWordBoundaries: (batch) => boundaries.push(...batch)
      },
      new AbortController().signal
    )

    expect(chunks.map((chunk) => [...chunk.audio])).toEqual([[1, 2, 3], [4, 5]])
    expect(chunks.every((chunk) => chunk.contentType === 'audio/mpeg')).toBe(true)
    expect(boundaries).toEqual([
      { word: 'Hello', startTime: 0, endTime: 0.45 },
      { word: 'world', startTime: 0.45, endTime: 0.8 }
    ])
    expect(summary).toEqual({
      contentType: 'audio/mpeg',
      audioBytes: 5,
      wordBoundaries: boundaries
    })

    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_URL}/dev/captioned_speech`)
    const init = fetchMock.mock.calls[0][1]
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' })
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'kokoro',
      input: 'Hello world',
      voice: 'af_heart',
      speed: 1.2,
      response_format: 'mp3',
      stream: true,
      return_timestamps: true
    })
  })

  it('concatenates the stream for buffered callers', async () => {
    const fetchMock = createFetchMock([
      { audio: encodeAudio([1, 2]), timestamps: [] },
      { audio: encodeAudio([3]), timestamps: [{ word: 'hi', start_time: 0, end_time: 0.2 }] }
    ])
    const provider = new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: fetchMock })

    const result = await provider.synthesize(
      { text: 'hi', voice: 'af_heart', rate: 1 },
      new AbortController().signal
    )

    expect([...result.audio]).toEqual([1, 2, 3])
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.wordBoundaries).toEqual([{ word: 'hi', startTime: 0, endTime: 0.2 }])
  })

  it('rejects a request the server would never accept', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const provider = new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: fetchMock })
    const signal = new AbortController().signal

    await expectProviderError(
      provider.synthesize({ text: 'hi', voice: 'en-US-AriaNeural', rate: 1 }, signal),
      'invalid-request'
    )
    await expectProviderError(
      provider.synthesize({ text: '   ', voice: 'af_heart', rate: 1 }, signal),
      'invalid-request'
    )
    await expectProviderError(
      provider.synthesize({ text: 'hi', voice: 'af_heart', rate: 9 }, signal),
      'invalid-request'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an unreachable or failing server as a connection failure', async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    await expectProviderError(
      new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: offline }).synthesize(
        { text: 'hi', voice: 'af_heart', rate: 1 },
        new AbortController().signal
      ),
      'connection-failed'
    )

    const failing = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('missing voice', { status: 404 })
    )
    await expectProviderError(
      new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: failing }).synthesize(
        { text: 'hi', voice: 'af_heart', rate: 1 },
        new AbortController().signal
      ),
      'connection-failed'
    )
  })

  it('reports a malformed stream and a silent response distinctly', async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(createNdjsonStream(['{"audio":"']))
    )
    await expectProviderError(
      new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: malformed }).synthesize(
        { text: 'hi', voice: 'af_heart', rate: 1 },
        new AbortController().signal
      ),
      'protocol-error'
    )

    const silent = createFetchMock([{ audio: '', timestamps: [] }])
    await expectProviderError(
      new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: silent }).synthesize(
        { text: 'hi', voice: 'af_heart', rate: 1 },
        new AbortController().signal
      ),
      'empty-audio'
    )
  })

  it('stops synthesis when the caller aborts', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    ))
    const provider = new KokoroTtsProvider({ baseUrl: BASE_URL, fetch: fetchMock })

    const pending = provider.synthesize(
      { text: 'hi', voice: 'af_heart', rate: 1 },
      controller.signal
    )
    controller.abort()

    await expectProviderError(pending, 'aborted')
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('refuses a server address that is not a plain HTTP origin', () => {
    expect(() => new KokoroTtsProvider({ baseUrl: 'ws://localhost:8880' }))
      .toThrow('HTTP or HTTPS origin')
  })
})

function encodeAudio(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

function createNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
      controller.close()
    }
  })
}

function createFetchMock(chunks: unknown[]): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(
    new Response(createNdjsonStream(chunks.map((chunk) => JSON.stringify(chunk))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  ))
}

async function expectProviderError(
  pending: Promise<unknown>,
  code: TtsProviderError['code']
): Promise<void> {
  await expect(pending).rejects.toMatchObject({ name: 'TtsProviderError', code })
}
