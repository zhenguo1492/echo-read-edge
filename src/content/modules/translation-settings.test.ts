import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getTranslationSettingsMock, setTranslationTargetLanguageMock } = vi.hoisted(
  () => ({
    getTranslationSettingsMock: vi.fn(),
    setTranslationTargetLanguageMock: vi.fn()
  })
)

vi.mock('@/storage', () => ({
  TRANSLATION_TARGET_KEY: 'translationTargetLanguage',
  settingsRepository: {
    getTranslationSettings: getTranslationSettingsMock,
    setTranslationTargetLanguage: setTranslationTargetLanguageMock
  }
}))

import {
  changeTranslationTargetLanguage,
  destroyTranslationSettings,
  initializeTranslationSettings,
  translationTargetLanguage
} from './translation-settings'

type StorageChanges = Record<string, chrome.storage.StorageChange>
type ChangeListener = (changes: StorageChanges, areaName: string) => void

let listeners: ChangeListener[]

beforeEach(() => {
  listeners = []
  getTranslationSettingsMock.mockReset().mockResolvedValue({ targetLanguage: 'ja' })
  setTranslationTargetLanguageMock.mockReset().mockResolvedValue({ targetLanguage: 'ja' })
  translationTargetLanguage.value = 'zh-CN'
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((current) => current !== listener)
        }
      }
    }
  })
})

afterEach(() => {
  destroyTranslationSettings()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('translation settings', () => {
  it('loads the stored target language', async () => {
    initializeTranslationSettings()

    await vi.waitFor(() => {
      expect(translationTargetLanguage.value).toBe('ja')
    })
  })

  it('keeps the default when the stored language cannot be read', async () => {
    getTranslationSettingsMock.mockRejectedValue(new Error('storage unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    initializeTranslationSettings()

    await vi.waitFor(() => {
      expect(getTranslationSettingsMock).toHaveBeenCalled()
    })
    expect(translationTargetLanguage.value).toBe('zh-CN')
  })

  it('follows a language stored by another surface', async () => {
    initializeTranslationSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    listeners[0]({ translationTargetLanguage: { newValue: 'fr' } }, 'local')

    expect(translationTargetLanguage.value).toBe('fr')
  })

  it('ignores changes to other keys and other storage areas', async () => {
    initializeTranslationSettings()
    await vi.waitFor(() => expect(translationTargetLanguage.value).toBe('ja'))

    listeners[0]({ speed: { newValue: 1.5 } }, 'local')
    listeners[0]({ translationTargetLanguage: { newValue: 'fr' } }, 'sync')

    expect(translationTargetLanguage.value).toBe('ja')
  })

  it('falls back to the default when an unknown language is stored', async () => {
    initializeTranslationSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    listeners[0]({ translationTargetLanguage: { newValue: 'kl' } }, 'local')

    expect(translationTargetLanguage.value).toBe('zh-CN')
  })

  it('stops following storage once destroyed', async () => {
    initializeTranslationSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    destroyTranslationSettings()

    expect(listeners).toHaveLength(0)
  })

  it('shows a chosen language before the write settles', async () => {
    let settle = (): void => undefined
    setTranslationTargetLanguageMock.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = () => resolve()
      })
    )

    const pending = changeTranslationTargetLanguage('fr')

    expect(translationTargetLanguage.value).toBe('fr')
    settle()
    await pending
    expect(setTranslationTargetLanguageMock).toHaveBeenCalledWith('fr')
  })

  it('restores the previous language when the write fails', async () => {
    setTranslationTargetLanguageMock.mockRejectedValue(new Error('storage unavailable'))

    await expect(changeTranslationTargetLanguage('fr')).rejects.toThrow(
      'storage unavailable'
    )

    expect(translationTargetLanguage.value).toBe('zh-CN')
  })

  it('rejects a language outside the offered targets without storing it', async () => {
    await expect(changeTranslationTargetLanguage('kl')).rejects.toThrow(TypeError)

    expect(setTranslationTargetLanguageMock).not.toHaveBeenCalled()
    expect(translationTargetLanguage.value).toBe('zh-CN')
  })
})
