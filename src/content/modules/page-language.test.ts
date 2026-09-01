import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTtsSettingsMock = vi.hoisted(() => vi.fn())

vi.mock('@/storage', () => ({
  TTS_ENGINE_KEY: 'ttsEngine',
  VOICE_LANGUAGE_KEY: 'voiceLanguage',
  VOICE_SELECTION_KEYS: ['voiceLanguage', 'voiceMap', 'kokoroVoiceMap'],
  settingsRepository: { getTtsSettings: getTtsSettingsMock }
}))

import {
  PAGE_LANGUAGE_RETRY_DELAY_MS,
  destroyPageLanguage,
  initializePageLanguage,
  pageReadingLanguage,
  readingLanguage
} from './page-language'

type StorageChanges = Record<string, { newValue?: unknown; oldValue?: unknown }>
type ChangeListener = (changes: StorageChanges, areaName: string) => void

interface DetectedLanguage {
  language: string
  percentage: number
}

let listeners: ChangeListener[]

const ENGLISH_ARTICLE =
  'The extension reads the page aloud and highlights the sentence that is being '
  + 'spoken, so the reader can follow along with the text on the page.'
const JAPANESE_ARTICLE =
  'この拡張機能はページを読み上げます。'

function stubChrome(languages: DetectedLanguage[] | null): void {
  listeners = []
  vi.stubGlobal('chrome', {
    ...(languages === null
      ? {}
      : {
          i18n: {
            detectLanguage: (
              _text: string,
              callback: (result: { isReliable: boolean; languages: DetectedLanguage[] }) => void
            ) => {
              callback({ isReliable: languages.length > 0, languages })
            }
          }
        }),
    storage: {
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((entry) => entry !== listener)
        }
      }
    }
  })
}

describe('page language', () => {
  beforeEach(() => {
    stubChrome([])
    getTtsSettingsMock.mockReset().mockResolvedValue({ voiceLanguage: 'en' })
    document.documentElement.lang = ''
    document.body.innerHTML = ''
    pageReadingLanguage.value = null
  })

  afterEach(() => {
    destroyPageLanguage()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports the language the browser detector is confident about', async () => {
    stubChrome([{ language: 'ja', percentage: 96 }])
    document.body.innerHTML = `<p>${JAPANESE_ARTICLE}</p>`

    initializePageLanguage()

    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('ja'))
  })

  it('reduces a regional verdict to the base language that owns a voice', async () => {
    stubChrome([{ language: 'zh-CN', percentage: 99 }])
    document.body.innerHTML = '<p>这是一篇中文文章。</p>'

    initializePageLanguage()

    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('zh'))
  })

  it('ignores a verdict that no language dominates', async () => {
    stubChrome([
      { language: 'ja', percentage: 34 },
      { language: 'en', percentage: 33 }
    ])
    document.body.innerHTML = `<p>${ENGLISH_ARTICLE}</p>`

    initializePageLanguage()

    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('en'))
  })

  it('reads the page text itself when the browser detector is unavailable', async () => {
    stubChrome(null)
    document.body.innerHTML = `<p>${ENGLISH_ARTICLE}</p>`

    initializePageLanguage()

    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('en'))
  })

  it('falls back to the declared document language when the text carries no evidence', async () => {
    stubChrome([])
    document.documentElement.lang = 'pt-BR'
    document.body.innerHTML = '<p>EchoRead 2.1</p>'

    initializePageLanguage()

    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('pt'))
  })

  it('reports no language for a page that declares none and shows no prose', async () => {
    initializePageLanguage()

    await vi.waitFor(() => expect(listeners).toHaveLength(1))
    expect(pageReadingLanguage.value).toBeNull()
  })

  it('detects again once late-rendered text arrives', async () => {
    vi.useFakeTimers()
    stubChrome(null)

    initializePageLanguage()
    await vi.advanceTimersByTimeAsync(0)
    expect(pageReadingLanguage.value).toBeNull()

    document.body.innerHTML = `<p>${ENGLISH_ARTICLE}</p>`
    await vi.advanceTimersByTimeAsync(PAGE_LANGUAGE_RETRY_DELAY_MS)

    expect(pageReadingLanguage.value).toBe('en')
  })

  it('yields to a reader who picks a reading language while the page is open', async () => {
    stubChrome([{ language: 'ja', percentage: 96 }])
    document.body.innerHTML = `<p>${JAPANESE_ARTICLE}</p>`

    initializePageLanguage()
    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('ja'))

    listeners[0]({ voiceLanguage: { newValue: 'en' } }, 'local')

    expect(pageReadingLanguage.value).toBeNull()
  })

  it('ignores storage changes that do not choose a voice', async () => {
    stubChrome([{ language: 'ja', percentage: 96 }])
    document.body.innerHTML = `<p>${JAPANESE_ARTICLE}</p>`

    initializePageLanguage()
    await vi.waitFor(() => expect(pageReadingLanguage.value).toBe('ja'))

    listeners[0]({ speed: { newValue: 1.5 } }, 'local')
    listeners[0]({ voiceLanguage: { newValue: 'en' } }, 'sync')

    expect(pageReadingLanguage.value).toBe('ja')
  })

  it('releases its storage listener when the page is discarded', async () => {
    initializePageLanguage()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    destroyPageLanguage()

    expect(listeners).toHaveLength(0)
  })

  describe('the language a page is read in', () => {
    it('is the detected one, and says the page decided it', async () => {
      stubChrome([{ language: 'ja', percentage: 96 }])
      document.body.innerHTML = `<p>${JAPANESE_ARTICLE}</p>`

      initializePageLanguage()

      await vi.waitFor(() =>
        expect(readingLanguage.value).toEqual({ code: 'ja', detected: true })
      )
    })

    it('is the reader’s stored language while the page has not said', async () => {
      getTtsSettingsMock.mockResolvedValue({ voiceLanguage: 'fr' })

      initializePageLanguage()

      await vi.waitFor(() =>
        expect(readingLanguage.value).toEqual({ code: 'fr', detected: false })
      )
    })

    it('follows the language the reader picks in the popup', async () => {
      stubChrome([{ language: 'ja', percentage: 96 }])
      document.body.innerHTML = `<p>${JAPANESE_ARTICLE}</p>`

      initializePageLanguage()
      await vi.waitFor(() => expect(readingLanguage.value.detected).toBe(true))

      listeners[0]({ voiceLanguage: { newValue: 'ko' } }, 'local')

      expect(readingLanguage.value).toEqual({ code: 'ko', detected: false })
    })

    it('re-reads the stored language after an engine change moves it', async () => {
      initializePageLanguage()
      await vi.waitFor(() => expect(listeners).toHaveLength(1))

      getTtsSettingsMock.mockResolvedValue({ voiceLanguage: 'en' })
      listeners[0]({ ttsEngine: { newValue: 'kokoro' } }, 'local')

      await vi.waitFor(() => expect(getTtsSettingsMock).toHaveBeenCalledTimes(2))
      expect(readingLanguage.value).toEqual({ code: 'en', detected: false })
    })
  })
})
