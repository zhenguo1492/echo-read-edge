import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetPronunciationVoices } from '@/shared/pronunciation-voices'
import type { DetailedDictionaryEntry } from '@/types'
import { WordDictionaryPanel } from './WordDictionaryPanel'

const EDGE_VOICES = [
  { id: 'en-GB-SoniaNeural', name: 'Sonia', locale: 'en-GB', gender: 'Female' },
  { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' }
]

let container: HTMLDivElement
const sendMessage = vi.fn()
const { getTtsSettingsMock } = vi.hoisted(() => ({ getTtsSettingsMock: vi.fn() }))

vi.mock('@/storage', () => ({
  settingsRepository: { getTtsSettings: getTtsSettingsMock }
}))

function createEntry(
  overrides: Partial<DetailedDictionaryEntry> = {}
): DetailedDictionaryEntry {
  return {
    word: 'read',
    ukPhonetic: '/riːd/',
    usPhonetic: '/riːd/',
    examTypes: [],
    meanings: [{ partOfSpeech: 'verb', definition: 'To interpret written text.' }],
    examples: [{ en: 'I read every day.', zh: '我每天阅读。' }],
    phrases: [{ phrase: 'read up', meaning: 'to study a subject' }],
    synonyms: [],
    discriminate: [],
    collins: [],
    ...overrides
  }
}

function answerWith(entry: DetailedDictionaryEntry) {
  return async (message: { action: string }) => {
    if (message.action === 'dictionary:lookup') {
      return { ok: true, entry, source: 'youdao' }
    }
    if (message.action === 'voices:list') {
      return { ok: true, source: 'network', voices: EDGE_VOICES }
    }
    return { ok: true, playbackId: 'popup-pronunciation', state: 'playing' }
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  forgetPronunciationVoices()
  getTtsSettingsMock.mockResolvedValue({
    engine: 'edge',
    voice: 'en-US-AriaNeural',
    speed: 1.1,
    voiceByLanguage: { en: 'en-US-AriaNeural' }
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  sendMessage.mockReset().mockImplementation(answerWith(createEntry()))
})

afterEach(() => {
  act(() => render(null, container))
  container.remove()
  vi.unstubAllGlobals()
})

describe('WordDictionaryPanel', () => {
  it('looks the saved word up and shows only the sections it has', async () => {
    await act(async () => {
      render(<WordDictionaryPanel word="read" onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('To interpret written text.')
    })

    expect(sendMessage).toHaveBeenCalledWith({ action: 'dictionary:lookup', word: 'read' })
    const tabs = [...container.querySelectorAll('.dictionary-panel-tabs button')].map(
      (button) => button.textContent
    )
    expect(tabs).toEqual(['Meanings', 'Examples', 'Phrases'])
    expect(container.textContent).toContain('Source: Youdao')
  })

  it('switches to another section of the same entry', async () => {
    await act(async () => {
      render(<WordDictionaryPanel word="read" onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('To interpret written text.')
    })

    const examplesTab = [
      ...container.querySelectorAll<HTMLButtonElement>('.dictionary-panel-tabs button')
    ].find((button) => button.textContent === 'Examples')
    act(() => examplesTab?.click())

    expect(container.textContent).toContain('I read every day.')
    expect(container.textContent).toContain('我每天阅读。')
  })

  it('speaks the headword with a voice from the selected engine', async () => {
    await act(async () => {
      render(<WordDictionaryPanel word="read" onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Play UK pronunciation"]'))
        .not.toBeNull()
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Play UK pronunciation"]')
        ?.click()
    })
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'tts:start',
        text: 'read',
        voice: 'en-GB-SoniaNeural',
        rate: 1.1
      })
    })
  })

  it('reports a failed lookup and retries on request', async () => {
    sendMessage.mockImplementation(async (message: { action: string }) => {
      if (message.action === 'dictionary:lookup') {
        return { ok: false, code: 'not-found', error: 'No entry was found for this word.' }
      }
      return { ok: true, source: 'network', voices: EDGE_VOICES }
    })

    await act(async () => {
      render(<WordDictionaryPanel word="read" onClose={vi.fn()} />, container)
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No entry was found for this word.')
    })

    sendMessage.mockImplementation(answerWith(createEntry()))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.dictionary-panel-retry')?.click()
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('To interpret written text.')
    })
  })

  it('closes on the close control', async () => {
    const onClose = vi.fn()
    await act(async () => {
      render(<WordDictionaryPanel word="read" onClose={onClose} />, container)
    })

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Close dictionary"]')
        ?.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
