/**
 * Flow cover for the reading language: a page written in one language must be
 * read with that language's voice without the reader configuring anything, and
 * must stop overriding the reader the moment they choose a language themselves.
 * Detection, stored settings, and the playback request only meet in the mounted
 * content script, so the wiring between them is only visible from here.
 */
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionInfo } from '@/types'

const readSentences = vi.fn()

vi.mock('@/content/modules/tts-player', () => ({
  initializeTtsPlayer: vi.fn(),
  disposeTtsPlayer: vi.fn(),
  disposeReading: vi.fn().mockResolvedValue(undefined),
  readSentences,
  pauseReading: vi.fn(),
  resumeReading: vi.fn(),
  playNextSentence: vi.fn(),
  playPreviousSentence: vi.fn()
}))

// Plain functions rather than mocks: this suite runs several cases, and the
// shared restoreMocks setting would strip a mocked implementation after the
// first one.
vi.mock('@/content/modules/highlight-overlay', () => ({
  initializeHighlightOverlay: () =>
    Promise.resolve({
      renderHighlights: () => undefined,
      clearHighlights: () => undefined,
      clearAllHighlights: () => undefined,
      scrollToHighlight: () => undefined,
      destroy: () => undefined
    }),
  destroyHighlightOverlay: () => undefined
}))

vi.mock('@/content/modules/example-speech-controller', () => ({
  initializeExampleSpeech: vi.fn(),
  destroyExampleSpeech: vi.fn()
}))

const storedSettings: Record<string, unknown> = {}
const storageListeners: Array<
  (changes: Record<string, unknown>, areaName: string) => void
> = []

let detectedLanguages: Array<{ language: string; percentage: number }> = []
let shadowRoot: ShadowRoot

function installChromeStub(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'unused' }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      getManifest: () => ({ version: '0.0.0' })
    },
    i18n: {
      detectLanguage: (
        _text: string,
        callback: (result: {
          isReliable: boolean
          languages: Array<{ language: string; percentage: number }>
        }) => void
      ) => {
        callback({ isReliable: true, languages: detectedLanguages })
      }
    },
    storage: {
      local: {
        async get(keys: string[]) {
          return Object.fromEntries(keys.map((key) => [key, storedSettings[key]]))
        },
        async set(items: Record<string, unknown>) {
          const changes = Object.fromEntries(
            Object.entries(items).map(([key, value]) => [
              key,
              { oldValue: storedSettings[key], newValue: value }
            ])
          )
          Object.assign(storedSettings, items)
          storageListeners.forEach((listener) => listener(changes, 'local'))
        }
      },
      onChanged: {
        addListener: (
          listener: (changes: Record<string, unknown>, areaName: string) => void
        ) => storageListeners.push(listener),
        removeListener: (
          listener: (changes: Record<string, unknown>, areaName: string) => void
        ) => {
          const index = storageListeners.indexOf(listener)
          if (index >= 0) storageListeners.splice(index, 1)
        }
      }
    }
  })
}

/** The content UI hides behind a closed shadow root, which its tests must read. */
function captureShadowRoot(): void {
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit
  ) {
    shadowRoot = attachShadow.call(this, { ...init, mode: 'open' })
    return shadowRoot
  })
}

function pressAndClick(selector: string): void {
  const element = shadowRoot.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Missing control: ${selector}`)
  act(() => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
  })
}

function selectSentence(text: string): SelectionInfo {
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  document.body.append(paragraph)
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  return {
    text,
    range,
    rects: [new DOMRect(100, 100, 120, 20)],
    sentences: [{ start: 0, end: text.length, text }]
  }
}

/** Reads the voice the content script asked the player to speak with. */
function requestedVoice(): string | undefined {
  const lastCall = readSentences.mock.calls.at(-1)
  return (lastCall?.[1] as { voice: string } | undefined)?.voice
}

async function readSelection(): Promise<void> {
  const { pageSelection } = await import('@/content/modules/page-selection')
  act(() => {
    pageSelection.value = selectSentence('これは日本語の文章です。')
  })
  pressAndClick('button[aria-label="Read selected text"]')
  await settle()
}

describe('reading language flow', () => {
  beforeEach(() => {
    readSentences.mockReset().mockResolvedValue(true)
    detectedLanguages = []
    storageListeners.length = 0
    Object.keys(storedSettings).forEach((key) => delete storedSettings[key])
    // Edge names its voices after the language they speak, so the assertions
    // below read as the language question they are really asking.
    storedSettings.ttsEngine = 'edge'
    document.documentElement.lang = ''
    document.body.innerHTML = ''
    installChromeStub()
    captureShadowRoot()
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(400, 100, 50, 20)
    )
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'))
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('reads a page in the language the page is written in', async () => {
    document.body.innerHTML = '<p>これは日本語で書かれた記事です。</p>'
    detectedLanguages = [{ language: 'ja', percentage: 99 }]

    await import('@/content/index')
    await settle()
    await readSelection()

    expect(requestedVoice()).toBe('ja-JP-NanamiNeural')
  })

  it('keeps the reader’s stored voice when the page language is unknown', async () => {
    // A Japanese phrase quoted on a page that says nothing about its own
    // language is not a Japanese page, and must not switch the reader's voice.
    document.body.innerHTML = '<p>EchoRead 2.1</p>'

    await import('@/content/index')
    await settle()
    await readSelection()

    expect(requestedVoice()).toBe('en-US-AriaNeural')
  })

  it('yields to a voice the reader chooses while the page is open', async () => {
    document.body.innerHTML = '<p>これは日本語で書かれた記事です。</p>'
    detectedLanguages = [{ language: 'ja', percentage: 99 }]

    await import('@/content/index')
    await settle()

    const { settingsRepository } = await import('@/storage')
    await settingsRepository.setVoiceLanguage('en')
    await readSelection()

    expect(requestedVoice()).toBe('en-US-AriaNeural')
  })
})
