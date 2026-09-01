import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createPrimerWaveFile,
  releaseAudioOutputPrimer,
  startAudioOutputPrimer
} from './audio-output-warmup'

class MockAudio {
  static instances: MockAudio[] = []

  readonly play = vi.fn(async () => {
    this.paused = false
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
  paused = true
  loop = false
  currentTime = 0

  constructor(readonly src: string) {
    MockAudio.instances.push(this)
  }
}

const createObjectUrlMock = vi.fn(() => 'blob:primer')
const NativeUrl = URL

class MockUrl extends NativeUrl {
  static readonly createObjectURL = createObjectUrlMock
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

describe('createPrimerWaveFile', () => {
  it('produces a mono 16-bit PCM RIFF file whose declared sizes match its bytes', () => {
    const wave = createPrimerWaveFile()
    const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength)

    expect(readAscii(wave, 0, 4)).toBe('RIFF')
    expect(readAscii(wave, 8, 4)).toBe('WAVE')
    expect(readAscii(wave, 36, 4)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(4, true)).toBe(wave.byteLength - 8)
    expect(view.getUint32(40, true)).toBe(wave.byteLength - 44)
  })

  it('keeps every sample at the inaudible one-bit dither amplitude', () => {
    const wave = createPrimerWaveFile()
    const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength)

    for (let offset = 44; offset < wave.byteLength; offset += 2) {
      expect(Math.abs(view.getInt16(offset, true))).toBe(1)
    }
  })
})

describe('audio output primer', () => {
  beforeAll(() => {
    vi.stubGlobal('Audio', MockAudio)
    vi.stubGlobal('URL', MockUrl)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loops one reused element so the output stream stays open between sessions', () => {
    startAudioOutputPrimer()
    expect(MockAudio.instances).toHaveLength(1)

    const element = MockAudio.instances[0]
    expect(element.loop).toBe(true)
    expect(element.play).toHaveBeenCalledOnce()

    startAudioOutputPrimer()

    expect(MockAudio.instances).toHaveLength(1)
    expect(element.play).toHaveBeenCalledOnce()
  })

  it('keeps the primer running through the handoff before stopping it', () => {
    vi.useFakeTimers()
    const element = getPrimer()
    element.pause.mockClear()

    releaseAudioOutputPrimer()
    vi.advanceTimersByTime(1_400)
    expect(element.pause).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(element.pause).toHaveBeenCalledOnce()
  })

  it('cancels a pending stop when the next session starts priming again', () => {
    vi.useFakeTimers()
    const element = getPrimer()
    element.pause.mockClear()

    releaseAudioOutputPrimer()
    startAudioOutputPrimer()
    vi.advanceTimersByTime(5_000)

    expect(element.pause).not.toHaveBeenCalled()
  })

  it('stops a primer that no sentence ever handed off to', () => {
    vi.useFakeTimers()
    const element = getPrimer()
    element.pause.mockClear()

    startAudioOutputPrimer()
    vi.advanceTimersByTime(30_000)

    expect(element.pause).toHaveBeenCalledOnce()
  })

  it('ignores a blocked primer so a failed warm-up cannot fail the session', async () => {
    const element = getPrimer()
    element.paused = true
    element.play.mockRejectedValueOnce(new Error('The primer was blocked.'))

    expect(() => startAudioOutputPrimer()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })
})

/** The module owns exactly one primer, created by whichever call comes first. */
function getPrimer(): MockAudio {
  startAudioOutputPrimer()
  return MockAudio.instances[0]
}
