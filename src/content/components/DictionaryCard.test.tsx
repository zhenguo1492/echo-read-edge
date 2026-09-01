import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetPronunciationVoices } from '@/shared/pronunciation-voices'
import type { DetailedDictionaryEntry } from '@/types'
import { DictionaryCard } from './DictionaryCard'

const KOKORO_VOICES = [
  { id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' },
  { id: 'am_michael', name: 'Michael', locale: 'en-US', gender: 'Male' },
  { id: 'bf_emma', name: 'Emma', locale: 'en-GB', gender: 'Female' }
]

let container: HTMLDivElement
const sendMessage = vi.fn()

function respondWithVoices(voices: unknown[]) {
  return async (message: { action: string }) => {
    if (message.action === 'dictionary:lookup') return { ok: true, entry: createEntry() }
    if (message.action === 'voices:list') return { ok: true, source: 'network', voices }
    return { ok: true, playbackId: 'dictionary-pronunciation', state: 'playing' }
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  forgetPronunciationVoices()
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  sendMessage.mockReset().mockImplementation(respondWithVoices(KOKORO_VOICES))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  act(() => render(null, container))
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DictionaryCard', () => {
  it('renders the migrated tabs and switches to detailed Collins content', async () => {
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 80, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('To interpret written text.')
    })

    expect(sendMessage).toHaveBeenCalledWith({ action: 'dictionary:lookup', word: 'read' })
    expect(container.querySelectorAll('.echo-read-edge-dictionary-arrow > span')).toHaveLength(3)
    expect(container.querySelector('.echo-read-edge-dictionary-arrow-cover')).not.toBeNull()
    const tabLabels = [...container.querySelectorAll('nav button')].map(
      (button) => button.textContent
    )
    expect(tabLabels).toEqual(['Meanings', 'Collins (1)', 'Examples', 'Synonyms', 'Phrases'])

    const collinsTab = [...container.querySelectorAll<HTMLButtonElement>('nav button')]
      .find((button) => button.textContent?.startsWith('Collins'))
    act(() => collinsTab?.click())
    expect(container.textContent).toContain('Reading means looking at written words.')
    expect(container.textContent).toContain('Reading broadens the mind.')
    expect(container.querySelector('button[aria-label^="Read example:"]')).not.toBeNull()

    const examplesTab = [...container.querySelectorAll<HTMLButtonElement>('nav button')]
      .find((button) => button.textContent === 'Examples')
    act(() => examplesTab?.click())
    expect(container.textContent).toContain('I read every day.')
    expect(container.querySelector('button[aria-label="Read example: I read every day."]'))
      .not.toBeNull()
  })

  it('speaks each accent with a voice from the selected engine', async () => {
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 80, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Play UK pronunciation"]'))
        .not.toBeNull()
    })

    act(() => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Play UK pronunciation"]'
      )?.click()
    })
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'tts:start',
        text: 'read',
        voice: 'bf_emma',
        rate: 1
      })
    })

    act(() => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Play US pronunciation"]'
      )?.click()
    })
    // The reader's own English voice is American, so it speaks the US entry.
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'tts:start',
        text: 'read',
        voice: 'af_heart',
        rate: 1
      })
    })
  })

  it('hides the speaker for an accent the engine cannot speak', async () => {
    sendMessage.mockImplementation(respondWithVoices(
      KOKORO_VOICES.filter((voice) => voice.locale === 'en-US')
    ))
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 80, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Play US pronunciation"]'))
        .not.toBeNull()
    })

    // The transcription still belongs on screen; only the playback control goes.
    expect(container.querySelector('button[aria-label="Play UK pronunciation"]')).toBeNull()
    expect(container.textContent).toContain('/riːd/')
  })

  it('offers no speaker at all when the engine catalog cannot be read', async () => {
    sendMessage.mockImplementation(async (message: { action: string }) => {
      if (message.action === 'dictionary:lookup') return { ok: true, entry: createEntry() }
      if (message.action === 'voices:list') return { ok: false, error: 'unavailable' }
      return { ok: true, playbackId: 'dictionary-pronunciation', state: 'playing' }
    })
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 80, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => expect(container.textContent).toContain('/riːd/'))

    expect(container.querySelector('button[aria-label^="Play "]')).toBeNull()
  })

  it('saves the word and its sentence without copying any definition', async () => {
    document.title = 'A reading page'
    const paragraph = document.createElement('p')
    paragraph.textContent = 'An earlier line. I read every day at home. A later line.'
    document.body.append(paragraph)
    const textNode = paragraph.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 21)
    range.setEnd(textNode, 25)
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 80, 20))
    sendMessage.mockImplementation(async (message: { action: string }) => {
      if (message.action === 'dictionary:lookup') return { ok: true, entry: createEntry() }
      if (message.action === 'vocabulary:status') return { ok: true, saved: false }
      return { ok: true, saved: true, savedAt: '2026-01-01T09:00:00.000Z' }
    })

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    const saveButton = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Save to vocabulary list"]'
      )
      expect(button).not.toBeNull()
      return button!
    })

    await act(async () => saveButton.click())

    expect(sendMessage).toHaveBeenCalledWith({
      action: 'vocabulary:save',
      word: 'read',
      context: 'I read every day at home.',
      sourceUrl: window.location.href,
      sourceTitle: 'A reading page'
    })
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Remove from vocabulary list"]'))
        .not.toBeNull()
    })
    paragraph.remove()
  })

  it('shows a retry action when the local dict service fails', async () => {
    sendMessage.mockResolvedValue({ ok: false, code: 'unavailable', error: 'Offline.' })
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 40, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Offline.')
    })

    expect(container.querySelector('button[aria-label="Close dictionary"]')?.textContent)
      .toBe('×')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Retry'))
      .toBe(true)
  })

  it('names the source that answered the lookup', async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      entry: createEntry(),
      source: 'free-dictionary'
    })
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 40, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.echo-read-edge-dictionary-source')?.textContent)
        .toBe('Source: Free Dictionary')
    })
  })

  it('follows the word Range when a scroll changes its viewport position', async () => {
    let anchorRect = new DOMRect(100, 60, 60, 20)
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockImplementation(() => anchorRect)

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!
    await vi.waitFor(() => expect(panel.style.top).toBe('90px'))

    anchorRect = new DOMRect(100, 200, 60, 20)
    window.dispatchEvent(new Event('scroll'))

    await vi.waitFor(() => expect(panel.style.top).toBe('230px'))
    expect(panel.style.left).toBe('10px')
  })

  it('repositions after ResizeObserver reports the panel actual height', async () => {
    const resize = { callback: null as ResizeObserverCallback | null }
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize.callback = callback
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    let panelRect = new DOMRect(0, 0, 427, 300)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => panelRect)
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 600, 60, 20))

    await act(async () => {
      render(<DictionaryCard word="read" range={range} onClose={vi.fn()} />, container)
    })
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!
    await vi.waitFor(() => expect(panel.style.top).toBe('290px'))

    panelRect = new DOMRect(0, 0, 427, 100)
    if (!resize.callback) throw new Error('ResizeObserver was not initialized.')
    resize.callback([], {} as ResizeObserver)

    await vi.waitFor(() => expect(panel.style.top).toBe('630px'))
    expect(panel.style.maxHeight).toBe('160px')
  })
})

function createEntry(): DetailedDictionaryEntry {
  return {
    word: 'read',
    ukPhonetic: '/riːd/',
    usPhonetic: '/riːd/',
    ukSpeech: 'https://dict.youdao.com/dictvoice?audio=uk-reading',
    usSpeech: 'https://dict.youdao.com/dictvoice?audio=us-reading',
    examTypes: ['CET4'],
    meanings: [{ partOfSpeech: 'v.', definition: 'To interpret written text.' }],
    collins: [{
      pos: 'VERB',
      definition: 'Reading means looking at written words.',
      examples: [{ en: 'Reading broadens the mind.', zh: '阅读开阔思维。' }]
    }],
    examples: [{ en: 'I read every day.', zh: '我每天阅读。' }],
    synonyms: [{ pos: 'v.', meaning: '阅读', words: ['study'] }],
    phrases: [{ phrase: 'read through', meaning: '通读' }],
    discriminate: []
  }
}
