/**
 * Flow cover for the reader's translation language: the choice made in the
 * floating controller's menu must reach the translation already on screen. The
 * controls and the panel only meet in the mounted content UI, so the press path
 * that broke this — the menu dismissing the panel it was about to change — is
 * only visible with both mounted together.
 */
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionInfo } from '@/types'

vi.mock('@/content/modules/tts-player', () => ({
  initializeTtsPlayer: vi.fn(),
  disposeTtsPlayer: vi.fn(),
  disposeReading: vi.fn().mockResolvedValue(undefined),
  readSentences: vi.fn().mockResolvedValue(undefined),
  pauseReading: vi.fn(),
  resumeReading: vi.fn(),
  playNextSentence: vi.fn(),
  playPreviousSentence: vi.fn()
}))

vi.mock('@/content/modules/highlight-overlay', () => ({
  initializeHighlightOverlay: vi.fn().mockResolvedValue({
    renderHighlights: vi.fn(),
    clearHighlights: vi.fn(),
    clearAllHighlights: vi.fn(),
    scrollToHighlight: vi.fn(),
    destroy: vi.fn()
  }),
  destroyHighlightOverlay: vi.fn()
}))

vi.mock('@/shared/example-speech-controller', () => ({
  initializeExampleSpeech: vi.fn(),
  destroyExampleSpeech: vi.fn(),
  setExampleSpeechPreemption: vi.fn()
}))

const sendMessage = vi.fn()
const storedSettings: Record<string, unknown> = {}
const storageListeners: Array<
  (changes: Record<string, unknown>, areaName: string) => void
> = []

let shadowRoot: ShadowRoot

function installChromeStub(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      getManifest: () => ({ version: '0.0.0' })
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
        removeListener: vi.fn()
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

function control<T extends HTMLElement>(selector: string): T {
  const element = shadowRoot.querySelector<T>(selector)
  if (!element) throw new Error(`Missing control: ${selector}`)
  return element
}

function pressAndClick(element: HTMLElement): void {
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

function translationTargets(): string[] {
  return sendMessage.mock.calls
    .map(([message]) => message as { action: string; targetLanguage: string })
    .filter((message) => message.action === 'translate:text')
    .map((message) => message.targetLanguage)
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

describe('translation language flow', () => {
  beforeEach(() => {
    sendMessage.mockReset()
    sendMessage.mockResolvedValue({
      ok: true,
      translation: 'Translated.',
      detectedLanguage: 'en'
    })
    storageListeners.length = 0
    Object.keys(storedSettings).forEach((key) => delete storedSettings[key])
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

  it('retranslates the open panel into the language chosen from the controls', async () => {
    await import('@/content/index')
    const { pageSelection } = await import('@/content/modules/page-selection')

    act(() => {
      pageSelection.value = selectSentence('A sentence chosen for translation.')
    })

    pressAndClick(control('button[aria-label="Translate reading selection"]'))
    await settle()
    expect(translationTargets()).toEqual(['zh-CN'])
    expect(shadowRoot.querySelector('.echo-read-edge-translation-panel')).not.toBeNull()

    pressAndClick(control('.echo-read-edge-controller-language'))
    // The press that opens the menu must leave the translation on screen.
    expect(shadowRoot.querySelector('.echo-read-edge-translation-panel')).not.toBeNull()

    pressAndClick(control('[role="menuitemradio"][data-language="ja"]'))
    await settle()

    expect(translationTargets()).toEqual(['zh-CN', 'ja'])
    expect(shadowRoot.querySelector('.echo-read-edge-translation-panel')).not.toBeNull()
    expect(storedSettings.translationTargetLanguage).toBe('ja')
  })
})
