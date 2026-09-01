import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyExampleSpeech } from '@/content/modules/example-speech-controller'
import { SpeakableExample } from './SpeakableExample'

let container: HTMLDivElement
let runtimeListener: ((message: unknown) => void) | null = null
const sendMessage = vi.fn()

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  sendMessage.mockReset().mockResolvedValue({
    ok: true,
    playbackId: 'example-playback',
    state: 'playing'
  })
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListener = listener
        }),
        removeListener: vi.fn()
      },
      sendMessage
    }
  })
})

afterEach(() => {
  act(() => render(null, container))
  destroyExampleSpeech()
  container.remove()
  vi.unstubAllGlobals()
})

describe('SpeakableExample', () => {
  it('plays from the speaker button and highlights the active boundary word', async () => {
    act(() => render(
      <SpeakableExample text="Read this example." translation="阅读这个例句。" />,
      container
    ))
    const button = container.querySelector<HTMLButtonElement>('button')!
    act(() => button.click())
    await vi.waitFor(() => {
      expect(container.querySelector('button')?.getAttribute('aria-label'))
        .toBe('Pause example: Read this example.')
    })

    act(() => {
      runtimeListener?.({
        action: 'tts:boundaries',
        playbackId: 'example-playback',
        wordBoundaries: [
          { word: 'Read', startTime: 0, endTime: 0.2 },
          { word: 'this', startTime: 0.2, endTime: 0.4 }
        ]
      })
      runtimeListener?.({
        action: 'tts:word',
        playbackId: 'example-playback',
        sentenceIndex: 0,
        wordIndex: 1
      })
    })

    expect(container.querySelector('span.is-speaking')?.textContent).toBe('this')
    expect(container.textContent).toContain('阅读这个例句。')
  })
})
