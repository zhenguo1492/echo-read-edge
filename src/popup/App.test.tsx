import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'

const {
  countWordsMock,
  listWordsMock,
  getTranslationSettingsMock,
  getTtsSettingsMock,
  setEngineMock,
  setKokoroBaseUrlMock,
  setTranslationTargetLanguageMock,
  setVoiceLanguageMock
} = vi.hoisted(() => ({
  countWordsMock: vi.fn(),
  listWordsMock: vi.fn(),
  getTranslationSettingsMock: vi.fn(),
  getTtsSettingsMock: vi.fn(),
  setEngineMock: vi.fn(),
  setKokoroBaseUrlMock: vi.fn(),
  setTranslationTargetLanguageMock: vi.fn(),
  setVoiceLanguageMock: vi.fn()
}))

vi.mock('@/storage', () => ({
  vocabularyRepository: {
    listWords: listWordsMock,
    removeWord: vi.fn(),
    countWords: countWordsMock
  },
  settingsRepository: {
    getTtsSettings: getTtsSettingsMock,
    setEngine: setEngineMock,
    setKokoroBaseUrl: setKokoroBaseUrlMock,
    setVoiceLanguage: setVoiceLanguageMock,
    setVoice: vi.fn(),
    setSpeed: vi.fn(),
    getTranslationSettings: getTranslationSettingsMock,
    setTranslationTargetLanguage: setTranslationTargetLanguageMock,
    getInterfaceSettings: vi.fn().mockResolvedValue({ floatingControllerVisible: true }),
    setFloatingControllerVisible: vi.fn()
  }
}))

let container: HTMLDivElement
let runtimeListener: ((message: unknown) => void) | null = null
const sendMessage = vi.fn()
const createTab = vi.fn()

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  runtimeListener = null
  listWordsMock.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  countWordsMock.mockReset().mockResolvedValue(0)
  getTtsSettingsMock.mockResolvedValue({
    engine: 'edge',
    kokoroBaseUrl: 'http://localhost:8880',
    voice: 'en-US-AriaNeural',
    voiceLanguage: 'en',
    voiceByLanguage: {},
    speed: 1
  })
  setEngineMock.mockReset()
  // Selecting a language stores it, so the mock answers with the new reading
  // language the popup then shows.
  setVoiceLanguageMock.mockReset().mockImplementation(async (languageCode: string) => ({
    ...await getTtsSettingsMock(),
    voiceLanguage: languageCode
  }))
  setKokoroBaseUrlMock.mockReset()
  getTranslationSettingsMock.mockReset().mockResolvedValue({ targetLanguage: 'zh-CN' })
  setTranslationTargetLanguageMock.mockReset()
  sendMessage.mockReset().mockImplementation(async (message: { action: string }) => {
    if (message.action === 'kokoro:health') return healthyKokoro()
    if (message.action === 'voices:list') {
      return {
        ok: true,
        source: 'network',
        voices: [
          { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' },
          { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', locale: 'zh-CN', gender: 'Female' }
        ]
      }
    }
    return {
      ok: true,
      playbackId: 'preview-playback',
      state: 'playing'
    }
  })
  createTab.mockReset().mockResolvedValue({ id: 1 })
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListener = listener
        }),
        removeListener: vi.fn()
      },
      sendMessage,
      getURL: (path: string) => `chrome-extension://echo-read/${path}`
    },
    tabs: { create: createTab }
  })
})

afterEach(() => {
  act(() => render(null, container))
  container.remove()
  vi.unstubAllGlobals()
})

function healthyKokoro(): unknown {
  return {
    status: 'ok',
    baseUrl: 'http://localhost:8880',
    message: 'http://localhost:8880 answered with 1 voice.'
  }
}

/**
 * The popup asks for the catalog and for the Kokoro verdict over the same
 * channel, so a test that stubs only the catalog would leave the icon reporting
 * a malformed answer.
 */
function answerWith(
  voices: readonly unknown[],
  health: unknown = healthyKokoro()
): void {
  sendMessage.mockImplementation(async (message: { action: string }) =>
    message.action === 'kokoro:health'
      ? health
      : { ok: true, source: 'network', voices })
}

function countHealthChecks(): number {
  return sendMessage.mock.calls
    .filter((call: unknown[]) => (call[0] as { action: string }).action === 'kokoro:health')
    .length
}

function findHealthIndicator(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('.connection-status')
}

describe('popup voice preview', () => {
  it('previews the configured voice for the selected language', async () => {
    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const languageSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice language"]'
    )!
    expect(Array.from(languageSelect.options).map((option) => option.value))
      .toEqual(['zh', 'en'])
    await act(async () => {
      languageSelect.value = 'zh'
      languageSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const previewButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Preview voice'
    )!
    expect(previewButton.title).toBe('欢迎使用 EchoRead。这是所选声音的预览。')
    await act(async () => previewButton.click())

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      action: 'tts:start',
      text: '欢迎使用 EchoRead。这是所选声音的预览。',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1
    }))
    expect(container.textContent).toContain('Stop preview')

    act(() => runtimeListener?.({
      action: 'tts:state',
      playbackId: 'preview-playback',
      state: 'ended'
    }))
    expect(container.textContent).toContain('Preview voice')
  })
})

describe('popup tabs', () => {
  it('opens the saved word list without leaving the settings behind', async () => {
    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const wordsTab = [...container.querySelectorAll<HTMLButtonElement>('.popup-tabs button')]
      .find((button) => button.textContent === 'Words')!
    await act(async () => wordsTab.click())

    await vi.waitFor(() => expect(container.textContent).toContain('No words saved yet.'))
    expect(container.textContent).not.toContain('Preview voice')

    const settingsTab = [...container.querySelectorAll<HTMLButtonElement>('.popup-tabs button')]
      .find((button) => button.textContent === 'Settings')!
    await act(async () => settingsTab.click())

    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))
  })
})

describe('popup saved word dictionary', () => {
  const SAVED_WORD = {
    id: 'resilient-id',
    word: 'resilient',
    normalizedWord: 'resilient',
    createdAt: '2026-02-02T10:00:00.000Z',
    updatedAt: '2026-02-02T10:00:00.000Z',
    schemaVersion: 1,
    occurrences: []
  }

  async function openWordList(): Promise<void> {
    listWordsMock.mockResolvedValue({ items: [SAVED_WORD], nextCursor: null })
    countWordsMock.mockResolvedValue(1)
    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const wordsTab = [...container.querySelectorAll<HTMLButtonElement>('.popup-tabs button')]
      .find((button) => button.textContent === 'Words')!
    await act(async () => wordsTab.click())
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))
  }

  function lookUpResilient(): Promise<void> {
    return act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Look up resilient"]'
      )!.click()
    })
  }

  it('opens the entry beside the list and widens the popup for it', async () => {
    sendMessage.mockImplementation(async (message: { action: string }) => {
      if (message.action === 'dictionary:lookup') {
        return {
          ok: true,
          source: 'youdao',
          entry: {
            word: 'resilient',
            examTypes: [],
            meanings: [{ partOfSpeech: 'adj', definition: 'Able to recover quickly.' }],
            examples: [],
            phrases: [],
            synonyms: [],
            discriminate: [],
            collins: []
          }
        }
      }
      return {
        ok: true,
        source: 'network',
        voices: [
          { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' }
        ]
      }
    })

    await openWordList()
    await lookUpResilient()

    await vi.waitFor(() => {
      expect(container.querySelector('.popup-dictionary')?.textContent)
        .toContain('Able to recover quickly.')
    })
    // The word list keeps its own column instead of being replaced by the entry.
    expect(container.querySelector('.popup-shell')?.textContent).toContain('resilient')
    // The entry column comes first, so the list stays where the reader clicked.
    expect(container.querySelector('.popup-layout')?.firstElementChild?.className)
      .toBe('popup-dictionary')
    expect(document.body.classList.contains('has-dictionary')).toBe(true)

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Close dictionary"]'
      )!.click()
    })
    expect(container.querySelector('.popup-dictionary')).toBeNull()
    expect(document.body.classList.contains('has-dictionary')).toBe(false)
  })

  it('leaves no entry open behind the settings tab', async () => {
    await openWordList()
    await lookUpResilient()
    await vi.waitFor(() => expect(container.querySelector('.popup-dictionary')).not.toBeNull())

    const settingsTab = [...container.querySelectorAll<HTMLButtonElement>('.popup-tabs button')]
      .find((button) => button.textContent === 'Settings')!
    await act(async () => settingsTab.click())

    expect(container.querySelector('.popup-dictionary')).toBeNull()
    expect(document.body.classList.contains('has-dictionary')).toBe(false)
  })
})

describe('popup translation settings', () => {
  it('shows the stored target and persists a new selection', async () => {
    getTranslationSettingsMock.mockResolvedValue({ targetLanguage: 'ja' })
    setTranslationTargetLanguageMock.mockResolvedValue({ targetLanguage: 'fr' })

    await act(async () => render(<App />, container))
    const select = await findTranslationSelect('ja')

    await act(async () => {
      select.value = 'fr'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setTranslationTargetLanguageMock).toHaveBeenCalledWith('fr')
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Translation language saved.')
    })
    expect(findTranslationSelectNow()?.value).toBe('fr')
  })

  it('restores the previous target when the selection cannot be saved', async () => {
    setTranslationTargetLanguageMock.mockRejectedValue(new Error('Storage is full.'))

    await act(async () => render(<App />, container))
    const select = await findTranslationSelect('zh-CN')

    await act(async () => {
      select.value = 'de'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await vi.waitFor(() => expect(container.textContent).toContain('Storage is full.'))
    expect(findTranslationSelectNow()?.value).toBe('zh-CN')
  })
})

function findTranslationSelectNow(): HTMLSelectElement | null {
  return container.querySelector<HTMLSelectElement>(
    'select[aria-label="Translation language"]'
  )
}

function findTranslationSelect(targetLanguage: string): Promise<HTMLSelectElement> {
  return vi.waitFor(() => {
    const select = findTranslationSelectNow()
    expect(select?.value).toBe(targetLanguage)
    return select!
  })
}

describe('popup speech engine settings', () => {
  it('offers the Kokoro server address only while that engine is selected', async () => {
    getTtsSettingsMock.mockResolvedValue({
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'af_heart',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'af_heart' },
      speed: 1
    })
    answerWith([{ id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' }])

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const address = container.querySelector<HTMLInputElement>(
      'input[aria-label="Kokoro server address"]'
    )!
    expect(address.value).toBe('http://localhost:8880')

    setKokoroBaseUrlMock.mockResolvedValue({
      engine: 'kokoro',
      kokoroBaseUrl: 'http://127.0.0.1:9000',
      voice: 'af_heart',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'af_heart' },
      speed: 1
    })
    await act(async () => {
      address.value = 'http://127.0.0.1:9000/'
      address.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setKokoroBaseUrlMock).toHaveBeenCalledWith('http://127.0.0.1:9000/')
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Kokoro server address saved.'))
  })

  it('switches engines and reloads the catalog of the new one', async () => {
    getTtsSettingsMock.mockResolvedValue({
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'af_heart',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'af_heart' },
      speed: 1
    })
    setEngineMock.mockResolvedValue({
      engine: 'edge',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'en-US-AriaNeural',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'en-US-AriaNeural' },
      speed: 1
    })
    answerWith([{ id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' }])

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const engineSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Speech engine"]'
    )!
    answerWith([
        { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' }
      ])
    await act(async () => {
      engineSelect.value = 'edge'
      engineSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(setEngineMock).toHaveBeenCalledWith('edge')
    await vi.waitFor(() => expect(container.textContent).toContain('Aria'))
    expect(container.querySelector('input[aria-label="Kokoro server address"]')).toBeNull()
  })
})

describe('popup documentation', () => {
  it('opens the generated help page in its own tab', async () => {
    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const helpButton = container.querySelector<HTMLButtonElement>('.help-button')!
    await act(async () => helpButton.click())

    expect(createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://echo-read/help/index.html'
    })
  })

  it('no longer prints the container start command beside the Kokoro address', async () => {
    getTtsSettingsMock.mockResolvedValue({
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'af_heart',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'af_heart' },
      speed: 1
    })
    answerWith([{ id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' }])

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Kokoro server'))

    expect(container.textContent).not.toContain('docker compose')
  })
})

describe('popup Kokoro connection indicator', () => {
  const KOKORO_SETTINGS = {
    engine: 'kokoro',
    kokoroBaseUrl: 'http://localhost:8880',
    voice: 'af_heart',
    voiceLanguage: 'en',
    voiceByLanguage: { en: 'af_heart' },
    speed: 1
  }
  const VOICES = [{ id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' }]

  it('marks a server that answers as a Kokoro API as usable', async () => {
    getTtsSettingsMock.mockResolvedValue(KOKORO_SETTINGS)
    answerWith(VOICES)

    await act(async () => render(<App />, container))

    await vi.waitFor(() => {
      expect(findHealthIndicator()?.classList.contains('is-ok')).toBe(true)
    })
    expect(sendMessage).toHaveBeenCalledWith({ action: 'kokoro:health' })
    expect(findHealthIndicator()?.getAttribute('aria-label'))
      .toContain('answered with 1 voice.')
  })

  it('marks a host that answers without the Kokoro API as unusable', async () => {
    getTtsSettingsMock.mockResolvedValue(KOKORO_SETTINGS)
    answerWith(VOICES, {
      status: 'incompatible',
      baseUrl: 'http://localhost:8880',
      message: 'The Kokoro voice list returned HTTP 404.'
    })

    await act(async () => render(<App />, container))

    await vi.waitFor(() => {
      expect(findHealthIndicator()?.classList.contains('is-incompatible')).toBe(true)
    })
    expect(findHealthIndicator()?.getAttribute('aria-label')).toContain('HTTP 404')
  })

  it('rechecks a saved address so a server started later can clear the mark', async () => {
    getTtsSettingsMock.mockResolvedValue(KOKORO_SETTINGS)
    answerWith(VOICES, {
      status: 'unreachable',
      baseUrl: 'http://localhost:8880',
      message: 'No Kokoro server answered at http://localhost:8880.'
    })

    await act(async () => render(<App />, container))
    await vi.waitFor(() => {
      expect(findHealthIndicator()?.classList.contains('is-unreachable')).toBe(true)
    })

    answerWith(VOICES)
    await act(async () => findHealthIndicator()!.click())

    await vi.waitFor(() => {
      expect(findHealthIndicator()?.classList.contains('is-ok')).toBe(true)
    })
  })

  it('checks the address the repository stored, not the one still being typed', async () => {
    getTtsSettingsMock.mockResolvedValue(KOKORO_SETTINGS)
    setKokoroBaseUrlMock.mockResolvedValue({
      ...KOKORO_SETTINGS,
      kokoroBaseUrl: 'http://127.0.0.1:9000'
    })
    answerWith(VOICES)

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(findHealthIndicator()).not.toBeNull())

    const health = { status: 'ok', baseUrl: 'http://127.0.0.1:9000', message: 'moved.' }
    answerWith(VOICES, health)
    const address = container.querySelector<HTMLInputElement>(
      'input[aria-label="Kokoro server address"]'
    )!
    await act(async () => {
      address.value = 'http://127.0.0.1:9000'
      address.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(findHealthIndicator()?.getAttribute('aria-label')).toContain('moved.')
    })
    // Mount checked the stored address; the save had to trigger a second one,
    // because the popup never probes a value the repository has not accepted.
    expect(countHealthChecks()).toBe(2)
  })

  it('reports an address the repository refuses without probing it', async () => {
    getTtsSettingsMock.mockResolvedValue(KOKORO_SETTINGS)
    setKokoroBaseUrlMock.mockRejectedValue(
      new TypeError('The Kokoro server address must be an HTTP or HTTPS origin.')
    )
    answerWith(VOICES)

    await act(async () => render(<App />, container))
    await vi.waitFor(() => {
      expect(findHealthIndicator()?.classList.contains('is-ok')).toBe(true)
    })

    const address = container.querySelector<HTMLInputElement>(
      'input[aria-label="Kokoro server address"]'
    )!
    await act(async () => {
      address.value = 'ftp://localhost'
      address.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(findHealthIndicator()?.classList.contains('is-incompatible')).toBe(true)
    })
    expect(findHealthIndicator()?.getAttribute('aria-label'))
      .toContain('must be an HTTP or HTTPS origin.')
  })

  it('keeps no verdict from a Kokoro address once another engine is selected', async () => {
    getTtsSettingsMock.mockResolvedValue(KOKORO_SETTINGS)
    setEngineMock.mockResolvedValue({
      engine: 'edge',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'en-US-AriaNeural',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'en-US-AriaNeural' },
      speed: 1
    })
    answerWith(VOICES)

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(findHealthIndicator()).not.toBeNull())

    const engineSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Speech engine"]'
    )!
    await act(async () => {
      engineSelect.value = 'edge'
      engineSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await vi.waitFor(() => expect(findHealthIndicator()).toBeNull())
  })
})

describe('popup voice picker grouping', () => {
  it('keeps one entry per stored language and shows the saved regional voice', async () => {
    getTtsSettingsMock.mockResolvedValue({
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'bf_emma',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'bf_emma' },
      speed: 1
    })
    answerWith([
        { id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' },
        { id: 'am_michael', name: 'Michael', locale: 'en-US', gender: 'Male' },
        { id: 'bf_emma', name: 'Emma', locale: 'en-GB', gender: 'Female' }
      ])

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    // American and British voices share the stored `en` key, so offering them as
    // two languages would let the picker display a voice that is not in effect.
    const languageSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice language"]'
    )!
    expect(Array.from(languageSelect.options).map((option) => option.value)).toEqual(['en'])

    const voiceSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="English voice"]'
    )!
    expect(voiceSelect.value).toBe('bf_emma')
    expect(Array.from(voiceSelect.options).map((option) => option.textContent)).toEqual([
      'Heart · Female (United States)',
      'Michael · Male (United States)',
      'Emma · Female (United Kingdom)'
    ])
  })

  it('omits the region label when a language has only one', async () => {
    getTtsSettingsMock.mockResolvedValue({
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880',
      voice: 'af_heart',
      voiceLanguage: 'en',
      voiceByLanguage: { en: 'af_heart', zh: 'zf_xiaoxiao' },
      speed: 1
    })
    answerWith([
        { id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' },
        { id: 'zf_xiaoxiao', name: 'Xiaoxiao', locale: 'zh-CN', gender: 'Female' },
        { id: 'zm_yunxi', name: 'Yunxi', locale: 'zh-CN', gender: 'Male' }
      ])

    await act(async () => render(<App />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('Preview voice'))

    const languageSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice language"]'
    )!
    await act(async () => {
      languageSelect.value = 'zh'
      languageSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const voiceSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Chinese voice"]'
    )!
    expect(Array.from(voiceSelect.options).map((option) => option.textContent)).toEqual([
      'Xiaoxiao · Female',
      'Yunxi · Male'
    ])
  })
})
