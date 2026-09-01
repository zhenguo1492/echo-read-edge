import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EdgeTtsProvider } from './edge-tts-provider'
import { MockWebSocket } from '@/test/mock-websocket'

const AUDIO_MARKER = new TextEncoder().encode('Path:audio\r\n')

describe('EdgeTtsProvider', () => {
  beforeEach(() => {
    MockWebSocket.reset()
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('converts a typed request into Edge protocol messages and normalized output', async () => {
    const provider = new EdgeTtsProvider()
    const synthesis = provider.synthesize(
      {
        text: 'Read <this> & that.',
        voice: 'en-US-AriaNeural',
        rate: 1.25
      },
      new AbortController().signal
    )

    const socket = await MockWebSocket.waitForConnection()
    expect(socket.url).toMatch(
      /^wss:\/\/speech\.platform\.bing\.com\/consumer\/speech\/synthesize\/readaloud\/edge\/v1\?/
    )
    expect(socket.binaryType).toBe('arraybuffer')

    socket.open()

    expect(socket.sentMessages).toHaveLength(2)
    expect(socket.sentMessages[0]).toContain('Path:speech.config')
    expect(socket.sentMessages[0]).toContain('"wordBoundaryEnabled":"true"')
    expect(socket.sentMessages[1]).toContain('Path:ssml')
    expect(socket.sentMessages[1]).toContain('voice name="en-US-AriaNeural"')
    expect(socket.sentMessages[1]).toContain('rate="1.25"')
    expect(socket.sentMessages[1]).toContain('Read &lt;this&gt; &amp; that.')

    socket.receive(
      protocolMessage('audio.metadata', {
        Metadata: [
          {
            Type: 'WordBoundary',
            Data: {
              Offset: 2_500_000,
              Duration: 1_250_000,
              text: { Text: 'Read' }
            }
          }
        ]
      })
    )
    socket.receive(audioMessage([1, 2, 3, 4]))
    socket.receive(protocolMessage('turn.end'))

    await expect(synthesis).resolves.toEqual({
      audio: new Uint8Array([1, 2, 3, 4]),
      contentType: 'audio/mpeg',
      wordBoundaries: [
        {
          word: 'Read',
          startTime: 0.25,
          endTime: 0.375
        }
      ]
    })
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
  })

  it('rejects invalid input before creating a WebSocket', async () => {
    const provider = new EdgeTtsProvider()

    await expect(
      provider.synthesize(
        {
          text: 'Hello.',
          voice: 'javascript:invalid-voice',
          rate: 1
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      name: 'TtsProviderError',
      code: 'invalid-request',
      message: 'The selected Edge voice is invalid.'
    })

    expect(MockWebSocket.connectionCount).toBe(0)
  })

  it('closes an in-flight WebSocket when synthesis is aborted', async () => {
    const provider = new EdgeTtsProvider()
    const controller = new AbortController()
    const synthesis = provider.synthesize(
      {
        text: 'Stop this request.',
        voice: 'en-US-AriaNeural',
        rate: 1
      },
      controller.signal
    )

    const socket = await MockWebSocket.waitForConnection()
    controller.abort()

    await expect(synthesis).rejects.toMatchObject({
      name: 'TtsProviderError',
      code: 'aborted',
      message: 'Speech synthesis was stopped.'
    })
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(socket.closeCode).toBe(1000)
  })

  it('reports an empty-audio error when Edge ends without MP3 data', async () => {
    const provider = new EdgeTtsProvider()
    const synthesis = provider.synthesize(
      {
        text: 'No audio returned.',
        voice: 'en-US-AriaNeural',
        rate: 1
      },
      new AbortController().signal
    )

    const socket = await MockWebSocket.waitForConnection()
    socket.open()
    socket.receive(protocolMessage('turn.end'))

    await expect(synthesis).rejects.toMatchObject({
      name: 'TtsProviderError',
      code: 'empty-audio'
    })
  })
})

function protocolMessage(path: string, body?: unknown): string {
  const serializedBody = body === undefined ? '' : JSON.stringify(body)
  return `Path:${path}\r\n\r\n${serializedBody}`
}

function audioMessage(audioBytes: number[]): ArrayBuffer {
  const result = new Uint8Array(AUDIO_MARKER.length + audioBytes.length)
  result.set(AUDIO_MARKER)
  result.set(audioBytes, AUDIO_MARKER.length)
  return result.buffer
}
