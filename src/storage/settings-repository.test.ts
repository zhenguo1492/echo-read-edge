import { describe, expect, it, vi } from 'vitest'

import { ChromeLocalSettingsRepository } from './settings-repository'

class MemorySettingsStorage {
  readonly set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(this.values, items)
  })

  constructor(private readonly values: Record<string, unknown> = {}) {}

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.map((key) => [key, this.values[key]]))
  }
}

describe('ChromeLocalSettingsRepository', () => {
  it('returns complete Kokoro defaults when storage is empty', async () => {
    const repository = new ChromeLocalSettingsRepository(new MemorySettingsStorage())

    const settings = await repository.getTtsSettings()

    expect(settings.engine).toBe('kokoro')
    expect(settings.kokoroBaseUrl).toBe('http://localhost:8880')
    expect(settings.voice).toBe('af_heart')
    expect(settings.voiceByLanguage?.zh).toBe('zf_xiaoxiao')
    expect(settings.speed).toBe(1)
  })

  it('returns complete Edge defaults when that engine is selected', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ ttsEngine: 'edge' })
    )

    const settings = await repository.getTtsSettings()

    expect(settings.voice).toBe('en-US-AriaNeural')
    expect(settings.voiceByLanguage?.zh).toBe('zh-CN-XiaoxiaoNeural')
  })

  it('keeps each engine voice map separate across a switch', async () => {
    const storage = new MemorySettingsStorage()
    const repository = new ChromeLocalSettingsRepository(storage)

    await repository.setVoice('en', 'bf_emma')
    await repository.setEngine('edge')
    const edgeSettings = await repository.setVoice('en', 'en-GB-RyanNeural')

    expect(edgeSettings.voice).toBe('en-GB-RyanNeural')
    expect(storage.set).toHaveBeenCalledWith({
      kokoroVoiceMap: expect.objectContaining({ en: 'bf_emma' }),
      voiceLanguage: 'en'
    })

    const restored = await repository.setEngine('kokoro')
    expect(restored.voice).toBe('bf_emma')
  })

  it('rejects a Kokoro voice while the Edge engine is selected', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ ttsEngine: 'edge' })
    )

    await expect(repository.setVoice('en', 'af_heart')).rejects.toThrow('does not belong')
  })

  it('stores only a normalized Kokoro server address', async () => {
    const storage = new MemorySettingsStorage()
    const repository = new ChromeLocalSettingsRepository(storage)

    const settings = await repository.setKokoroBaseUrl('http://127.0.0.1:8880/')

    expect(settings.kokoroBaseUrl).toBe('http://127.0.0.1:8880')
    expect(storage.set).toHaveBeenCalledWith({ kokoroBaseUrl: 'http://127.0.0.1:8880' })
    await expect(repository.setKokoroBaseUrl('ws://localhost:8880')).rejects.toThrow(
      'HTTP or HTTPS origin'
    )
  })

  it('falls back to the bundled server address when a stored one is unusable', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ kokoroBaseUrl: 'javascript:alert(1)' })
    )

    await expect(repository.getTtsSettings()).resolves.toMatchObject({
      kokoroBaseUrl: 'http://localhost:8880'
    })
  })

  it('migrates locale-keyed legacy voices to base language keys', async () => {
    const repository = new ChromeLocalSettingsRepository(new MemorySettingsStorage({
      ttsEngine: 'edge',
      voiceMap: {
        'en-US': 'en-US-GuyNeural',
        'en-GB': 'en-GB-SoniaNeural',
        'fr-FR': 'fr-FR-HenriNeural',
        invalid: 'javascript:alert(1)'
      },
      speed: 1.4,
      englishDialect: 'en-GB'
    }))

    const settings = await repository.getTtsSettings()

    expect(settings.voice).toBe('en-GB-SoniaNeural')
    expect(settings.voiceByLanguage?.fr).toBe('fr-FR-HenriNeural')
    expect(settings.voiceByLanguage?.invalid).toBeUndefined()
    expect(settings.speed).toBe(1.4)
  })

  it('persists one language without replacing the other selections', async () => {
    const storage = new MemorySettingsStorage({ ttsEngine: 'edge' })
    const repository = new ChromeLocalSettingsRepository(storage)

    const settings = await repository.setVoice('ja', 'ja-JP-KeitaNeural')

    expect(settings.voiceByLanguage?.ja).toBe('ja-JP-KeitaNeural')
    expect(settings.voiceByLanguage?.en).toBe('en-US-AriaNeural')
    expect(storage.set).toHaveBeenCalledWith({
      voiceMap: expect.objectContaining({
        ja: 'ja-JP-KeitaNeural',
        en: 'en-US-AriaNeural'
      }),
      voiceLanguage: 'ja'
    })
  })

  it('speaks with the voice of the language the reader selected', async () => {
    const storage = new MemorySettingsStorage({ ttsEngine: 'edge' })
    const repository = new ChromeLocalSettingsRepository(storage)

    await repository.setVoice('ja', 'ja-JP-KeitaNeural')
    const settings = await repository.setVoiceLanguage('en')

    expect(settings.voiceLanguage).toBe('en')
    expect(settings.voice).toBe('en-US-AriaNeural')
    expect(storage.set).toHaveBeenCalledWith({ voiceLanguage: 'en' })
    expect((await repository.getTtsSettings()).voice).toBe('en-US-AriaNeural')
  })

  it('accepts a regional language code as the reading language', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ ttsEngine: 'edge' })
    )

    const settings = await repository.setVoiceLanguage('ja-JP')

    expect(settings.voiceLanguage).toBe('ja')
  })

  it('rejects a reading language the selected engine cannot speak', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ ttsEngine: 'edge' })
    )

    await expect(repository.setVoiceLanguage('xx')).rejects.toThrow('no voice')
  })

  it('reads in English when the stored language is absent from the engine', async () => {
    const repository = new ChromeLocalSettingsRepository(new MemorySettingsStorage({
      ttsEngine: 'openai',
      voiceLanguage: 'ar'
    }))

    const settings = await repository.getTtsSettings()

    expect(settings.voiceLanguage).toBe('en')
    expect(settings.voice).toBe(settings.voiceByLanguage?.en)
  })

  it('adds default selections for languages discovered in the cached catalog', async () => {
    const repository = new ChromeLocalSettingsRepository(new MemorySettingsStorage({
      ttsEngine: 'edge',
      edgeVoiceCatalogCache: {
        version: 1,
        fetchedAt: 123,
        voices: [
          { id: 'sv-SE-SofieNeural', name: 'Sofie', locale: 'sv-SE', gender: 'Female' }
        ]
      }
    }))

    const settings = await repository.getTtsSettings()

    expect(settings.voiceByLanguage?.sv).toBe('sv-SE-SofieNeural')
  })

  it('defaults the translation target to the legacy Chinese behaviour', async () => {
    const repository = new ChromeLocalSettingsRepository(new MemorySettingsStorage())

    await expect(repository.getTranslationSettings()).resolves.toEqual({
      targetLanguage: 'zh-CN'
    })
  })

  it('reads a stored translation target and discards an unsupported one', async () => {
    const stored = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ translationTargetLanguage: 'ja' })
    )
    const corrupted = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ translationTargetLanguage: 'javascript:alert(1)' })
    )

    await expect(stored.getTranslationSettings()).resolves.toEqual({ targetLanguage: 'ja' })
    await expect(corrupted.getTranslationSettings()).resolves.toEqual({
      targetLanguage: 'zh-CN'
    })
  })

  it('persists only an offered translation target', async () => {
    const storage = new MemorySettingsStorage()
    const repository = new ChromeLocalSettingsRepository(storage)

    await expect(repository.setTranslationTargetLanguage('fr')).resolves.toEqual({
      targetLanguage: 'fr'
    })
    expect(storage.set).toHaveBeenCalledWith({ translationTargetLanguage: 'fr' })
    await expect(repository.setTranslationTargetLanguage('xx')).rejects.toThrow(
      'available translation target'
    )
  })

  it('shows the floating controller until the reader stores otherwise', async () => {
    const storage = new MemorySettingsStorage()
    const repository = new ChromeLocalSettingsRepository(storage)

    await expect(repository.getInterfaceSettings()).resolves.toEqual({
      floatingControllerVisible: true
    })

    await expect(repository.setFloatingControllerVisible(false)).resolves.toEqual({
      floatingControllerVisible: false
    })
    expect(storage.set).toHaveBeenCalledWith({ showFloatingController: false })
    await expect(repository.getInterfaceSettings()).resolves.toEqual({
      floatingControllerVisible: false
    })
  })

  it('ignores a non-boolean stored controller visibility', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ showFloatingController: 'yes' })
    )

    await expect(repository.getInterfaceSettings()).resolves.toEqual({
      floatingControllerVisible: true
    })
  })

  it('rejects mismatched voices and out-of-range speeds', async () => {
    const repository = new ChromeLocalSettingsRepository(
      new MemorySettingsStorage({ ttsEngine: 'edge' })
    )

    await expect(repository.setVoice('fr', 'en-US-AriaNeural')).rejects.toThrow(
      'does not belong'
    )
    await expect(repository.setSpeed(2.1)).rejects.toThrow('between 0.5 and 2')
  })
})
