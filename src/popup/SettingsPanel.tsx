import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import {
  DEFAULT_KOKORO_VOICE_BY_LANGUAGE,
  KOKORO_FALLBACK_VOICES
} from '@/lib/kokoro-voices'
import {
  DEFAULT_EDGE_VOICE_BY_LANGUAGE,
  EDGE_VOICE_LANGUAGES
} from '@/lib/edge-voices'
import {
  DEFAULT_KOKORO_BASE_URL,
  DEFAULT_TTS_ENGINE,
  normalizeKokoroBaseUrl,
  TTS_ENGINES,
  type TtsEngineId
} from '@/lib/tts-engines'
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  TRANSLATION_TARGET_LANGUAGES
} from '@/lib/translation-languages'
import type {
  KokoroHealthRequest,
  KokoroHealthResponse,
  TtsCommandResponse,
  TtsPlaybackEvent,
  TtsStartRequest,
  TtsStopRequest,
  VoiceListRequest,
  VoiceListResponse,
  VoiceRecord
} from '@/shared/messages'
import { isKokoroHealthResponse } from '@/shared/messages'
import { settingsRepository } from '@/storage'
import {
  KokoroHealthIndicator,
  type KokoroHealthState
} from './KokoroHealthIndicator'

/** The documentation page the build renders from README.md. */
const HELP_PAGE_PATH = 'help/index.html'

/**
 * Opens the generated documentation in its own tab. The popup closes as soon as
 * the tab takes focus, so a failure is reported to the console rather than to a
 * status line nobody would still be looking at.
 */
function openHelpPage(): void {
  try {
    void chrome.tabs.create({ url: chrome.runtime.getURL(HELP_PAGE_PATH) })
  } catch (error) {
    console.error('Could not open the help page:', error)
  }
}

const UNCHECKED_KOKORO_HEALTH: KokoroHealth = {
  state: 'unknown',
  message: 'not checked yet.'
}

/** Migrated local-only reading settings for the selectable speech engines. */
export function SettingsPanel(): JSX.Element {
  const [engine, setEngine] = useState<TtsEngineId>(DEFAULT_TTS_ENGINE)
  const [kokoroBaseUrl, setKokoroBaseUrl] = useState(DEFAULT_KOKORO_BASE_URL)
  const [voiceByLanguage, setVoiceByLanguage] = useState<Record<string, string>>({
    ...defaultVoicesFor(DEFAULT_TTS_ENGINE)
  })
  const [speed, setSpeed] = useState(1)
  const [translationLanguage, setTranslationLanguage] = useState(
    DEFAULT_TRANSLATION_TARGET_LANGUAGE
  )
  const [showFloatingController, setShowFloatingController] = useState(true)
  const [voiceGroups, setVoiceGroups] = useState<VoiceLanguageGroup[]>(
    createFallbackVoiceGroups(DEFAULT_TTS_ENGINE)
  )
  const [selectedLanguageCode, setSelectedLanguageCode] = useState('en')
  const [isLoading, setIsLoading] = useState(true)
  const [isPreviewStarting, setIsPreviewStarting] = useState(false)
  const [previewPlaybackId, setPreviewPlaybackId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [kokoroHealth, setKokoroHealth] = useState<KokoroHealth>(UNCHECKED_KOKORO_HEALTH)
  const previewPlaybackIdRef = useRef<string | null>(null)
  /**
   * Two probes can be in flight after a quick address correction, and the first
   * one may answer last. Only the newest is allowed to reach the icon.
   */
  const healthCheckIdRef = useRef(0)
  const selectedLanguage = voiceGroups.find(
    (language) => language.code === selectedLanguageCode
  ) ?? voiceGroups[0]
  const previewText = selectedLanguage.previewText
  const selectedVoiceId = selectedLanguage.voices.some(
    (voice) => voice.id === voiceByLanguage[selectedLanguage.languageCode]
  )
    ? voiceByLanguage[selectedLanguage.languageCode]
    : selectedLanguage.voices[0].id

  useEffect(() => {
    void (async () => {
      try {
        const settings = await settingsRepository.getTtsSettings()
        setEngine(settings.engine)
        setKokoroBaseUrl(settings.kokoroBaseUrl)
        setSpeed(settings.speed)
        setSelectedLanguageCode(settings.voiceLanguage)
        await loadVoices(
          settings.engine,
          settings.voiceByLanguage,
          settings.voiceLanguage
        )
        if (settings.engine === 'kokoro') void refreshKokoroHealth()
        const translationSettings = await settingsRepository.getTranslationSettings()
        setTranslationLanguage(translationSettings.targetLanguage)
        const interfaceSettings = await settingsRepository.getInterfaceSettings()
        setShowFloatingController(interfaceSettings.floatingControllerVisible)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Settings could not be loaded.')
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  /**
   * The background answers with the catalog of whichever engine is stored, so
   * the voice list is reloaded after any change that can move that catalog.
   */
  async function loadVoices(
    activeEngine: TtsEngineId,
    storedVoices: Readonly<Record<string, string>> | undefined,
    activeLanguage: string
  ): Promise<void> {
    const request: VoiceListRequest = { action: 'voices:list' }
    const response = await chrome.runtime.sendMessage<VoiceListRequest, VoiceListResponse>(
      request
    )
    const groups = response.ok
      ? groupVoicesByLanguage(response.voices, defaultVoicesFor(activeEngine))
      : createFallbackVoiceGroups(activeEngine)

    setVoiceGroups(groups)
    if (!groups.some((group) => group.code === activeLanguage)) {
      setSelectedLanguageCode(
        groups.find((group) => group.code === 'en')?.code ?? groups[0].code
      )
    }
    setVoiceByLanguage({ ...defaultVoicesFor(activeEngine), ...storedVoices })
    if (response.ok && response.source === 'fallback') {
      setStatus(activeEngine === 'kokoro'
        ? `No Kokoro server answered at ${kokoroBaseUrl}. Showing built-in voices.`
        : 'Using the built-in voice list while Edge is unavailable.')
    }
  }

  async function changeEngine(nextEngine: TtsEngineId): Promise<void> {
    await stopPreview()
    setStatus('Switching speech engine...')

    try {
      const settings = await settingsRepository.setEngine(nextEngine)
      setEngine(settings.engine)
      setSelectedLanguageCode(settings.voiceLanguage)
      setKokoroBaseUrl(settings.kokoroBaseUrl)
      await loadVoices(
        settings.engine,
        settings.voiceByLanguage,
        settings.voiceLanguage
      )
      // The icon belongs to the Kokoro field, so leaving that engine retires
      // the verdict instead of keeping a stale one for the next visit.
      if (settings.engine === 'kokoro') void refreshKokoroHealth()
      else setKokoroHealth(UNCHECKED_KOKORO_HEALTH)
      setStatus('Speech engine saved.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The engine could not be saved.')
    }
  }

  async function changeKokoroBaseUrl(value: string): Promise<void> {
    if (normalizeKokoroBaseUrl(value) === kokoroBaseUrl) return

    await stopPreview()
    setStatus('Saving Kokoro server address...')

    try {
      const settings = await settingsRepository.setKokoroBaseUrl(value)
      setKokoroBaseUrl(settings.kokoroBaseUrl)
      await loadVoices(
        settings.engine,
        settings.voiceByLanguage,
        settings.voiceLanguage
      )
      setStatus('Kokoro server address saved.')
      void refreshKokoroHealth()
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'The address could not be saved.'
      setStatus(message)
      // An address the repository refuses is never probed, so the icon has to
      // report that refusal itself rather than keep the previous server's mark.
      healthCheckIdRef.current += 1
      setKokoroHealth({ state: 'incompatible', message })
    }
  }

  /**
   * The background probes the address it has stored, so this runs after a save
   * rather than on every keystroke.
   */
  async function refreshKokoroHealth(): Promise<void> {
    const checkId = ++healthCheckIdRef.current
    setKokoroHealth({ state: 'checking', message: 'checking...' })

    const request: KokoroHealthRequest = { action: 'kokoro:health' }
    try {
      const response = await chrome.runtime.sendMessage<
        KokoroHealthRequest,
        KokoroHealthResponse
      >(request)
      if (checkId !== healthCheckIdRef.current) return

      setKokoroHealth(isKokoroHealthResponse(response)
        ? { state: response.status, message: response.message }
        : { state: 'unreachable', message: 'The check returned an unusable answer.' })
    } catch (error) {
      if (checkId !== healthCheckIdRef.current) return
      setKokoroHealth({
        state: 'unreachable',
        message: error instanceof Error
          ? error.message
          : 'The speech runtime did not answer the check.'
      })
    }
  }

  useEffect(() => {
    const handleRuntimeMessage = (message: unknown): void => {
      if (!isPreviewPlaybackEvent(message)) return
      if (message.playbackId !== previewPlaybackIdRef.current) return

      if (message.error) setStatus(`Preview failed: ${message.error.message}`)
      if (message.state === 'ended' || message.state === 'stopped') {
        previewPlaybackIdRef.current = null
        setPreviewPlaybackId(null)
      }
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
      const playbackId = previewPlaybackIdRef.current
      if (playbackId) void sendPreviewStop(playbackId)
    }
  }, [])

  async function changeVoice(languageCode: string, voiceId: string): Promise<void> {
    await stopPreview()
    const previousVoice = voiceByLanguage[languageCode]
    setVoiceByLanguage((current) => ({ ...current, [languageCode]: voiceId }))
    setStatus('Saving voice...')

    try {
      const settings = await settingsRepository.setVoice(languageCode, voiceId)
      setVoiceByLanguage({
        ...defaultVoicesFor(settings.engine),
        ...settings.voiceByLanguage
      })
      setStatus('Voice saved.')
    } catch (error) {
      setVoiceByLanguage((current) => ({ ...current, [languageCode]: previousVoice }))
      setStatus(error instanceof Error ? error.message : 'The voice could not be saved.')
    }
  }

  async function changeSpeed(value: number): Promise<void> {
    await stopPreview()
    const previousSpeed = speed
    setSpeed(value)
    setStatus('Saving speed...')

    try {
      const settings = await settingsRepository.setSpeed(value)
      setSpeed(settings.speed)
      setStatus('Speed saved.')
    } catch (error) {
      setSpeed(previousSpeed)
      setStatus(error instanceof Error ? error.message : 'The speed could not be saved.')
    }
  }

  async function changeTranslationLanguage(languageCode: string): Promise<void> {
    const previousLanguage = translationLanguage
    setTranslationLanguage(languageCode)
    setStatus('Saving translation language...')

    try {
      const settings = await settingsRepository.setTranslationTargetLanguage(languageCode)
      setTranslationLanguage(settings.targetLanguage)
      setStatus('Translation language saved.')
    } catch (error) {
      setTranslationLanguage(previousLanguage)
      setStatus(
        error instanceof Error
          ? error.message
          : 'The translation language could not be saved.'
      )
    }
  }

  /**
   * The chosen language is a stored setting, not a way to browse the catalog:
   * its voice is the one every reading uses until the reader changes it.
   */
  /**
   * Pages watch this key, so an open tab shows or hides its controller without
   * being reloaded. The optimistic value is rolled back if the write fails.
   */
  async function changeFloatingController(visible: boolean): Promise<void> {
    const previous = showFloatingController
    setShowFloatingController(visible)
    try {
      await settingsRepository.setFloatingControllerVisible(visible)
      setStatus(visible ? 'Reading controls shown.' : 'Reading controls hidden.')
    } catch (error) {
      setShowFloatingController(previous)
      setStatus(
        error instanceof Error ? error.message : 'The setting could not be saved.'
      )
    }
  }

  async function selectLanguage(languageCode: string): Promise<void> {
    await stopPreview()
    const previousLanguage = selectedLanguageCode
    setSelectedLanguageCode(languageCode)
    setStatus('Saving reading language...')

    try {
      const settings = await settingsRepository.setVoiceLanguage(languageCode)
      setSelectedLanguageCode(settings.voiceLanguage)
      setStatus('Reading language saved.')
    } catch (error) {
      setSelectedLanguageCode(previousLanguage)
      setStatus(
        error instanceof Error ? error.message : 'The language could not be saved.'
      )
    }
  }

  async function togglePreview(): Promise<void> {
    if (previewPlaybackIdRef.current) {
      await stopPreview()
      setStatus('Preview stopped.')
      return
    }

    setIsPreviewStarting(true)
    setStatus('Starting voice preview...')
    const request: TtsStartRequest = {
      action: 'tts:start',
      text: previewText,
      voice: selectedVoiceId,
      rate: speed
    }

    try {
      const response = await chrome.runtime.sendMessage<TtsStartRequest, TtsCommandResponse>(
        request
      )
      if (!response.ok) {
        setStatus(`Preview failed: ${response.error.message}`)
        return
      }

      previewPlaybackIdRef.current = response.playbackId
      setPreviewPlaybackId(response.playbackId)
      setStatus('Playing voice preview...')
    } catch (error) {
      setStatus(
        `Preview failed: ${error instanceof Error ? error.message : 'The speech runtime did not respond.'}`
      )
    } finally {
      setIsPreviewStarting(false)
    }
  }

  async function stopPreview(): Promise<void> {
    const playbackId = previewPlaybackIdRef.current
    if (!playbackId) return

    previewPlaybackIdRef.current = null
    setPreviewPlaybackId(null)
    try {
      await sendPreviewStop(playbackId)
    } catch {
      // The preview may already have ended or the popup may be closing.
    }
  }

  return (
    <>
      <label class="quick-setting switch-setting">
        <input
          type="checkbox"
          aria-label="Show the floating reading controls"
          checked={showFloatingController}
          disabled={isLoading}
          onChange={(event) => void changeFloatingController(
            (event.currentTarget as HTMLInputElement).checked
          )}
        />
        <span>Floating controls on pages</span>
      </label>

      <section class="settings-section" aria-labelledby="engine-settings-title">
        <div class="section-heading section-heading-with-action">
          <div>
            <h2 id="engine-settings-title">Speech engine</h2>
            <p>{TTS_ENGINES.find((option) => option.id === engine)?.description}</p>
          </div>
          <button
            type="button"
            class="help-button"
            aria-label="Open the EchoRead Edge documentation"
            title="Open the documentation in a new tab"
            onClick={openHelpPage}
          >
            Help
          </button>
        </div>

        <label class="select-setting">
          <span>Engine</span>
          <select
            aria-label="Speech engine"
            value={engine}
            disabled={isLoading || isPreviewStarting}
            onChange={(event) => void changeEngine(
              (event.currentTarget as HTMLSelectElement).value as TtsEngineId
            )}
          >
            {TTS_ENGINES.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        {engine === 'kokoro' ? (
          <div class="text-setting">
            <label for="kokoro-server-address">Kokoro server</label>
            <div class="input-with-status">
              <input
                id="kokoro-server-address"
                aria-label="Kokoro server address"
                type="url"
                inputMode="url"
                spellcheck={false}
                placeholder={DEFAULT_KOKORO_BASE_URL}
                value={kokoroBaseUrl}
                disabled={isLoading || isPreviewStarting}
                onChange={(event) => void changeKokoroBaseUrl(
                  (event.currentTarget as HTMLInputElement).value
                )}
              />
              <KokoroHealthIndicator
                state={kokoroHealth.state}
                message={kokoroHealth.message}
                onCheck={() => void refreshKokoroHealth()}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section class="settings-section" aria-labelledby="voice-settings-title">
        <div class="section-heading">
          <h2 id="voice-settings-title">Reading voice</h2>
          <p>
            EchoRead always reads with the voice selected here. Pick another
            language to read in it; each language keeps its own chosen voice.
          </p>
        </div>

        {isLoading ? (
          <p class="loading-message">Loading settings...</p>
        ) : (
          <div class="voice-picker">
            <label class="select-setting">
              <span>Language</span>
              <select
                aria-label="Voice language"
                value={selectedLanguageCode}
                disabled={isPreviewStarting}
                onChange={(event) => void selectLanguage(
                  (event.currentTarget as HTMLSelectElement).value
                )}
              >
                {voiceGroups.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>

            <div class="voice-field">
              <div class="voice-field-header">
                <span class="voice-field-label">Voice</span>

                {/* Icon-only trigger: the label text stays for screen readers and tests. */}
                <button
                  class="preview-button"
                  type="button"
                  title={previewText}
                  disabled={isPreviewStarting}
                  onClick={() => void togglePreview()}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M8.4 2.3 4.9 5.2H2.6a.9.9 0 0 0-.9.9v3.8c0 .5.4.9.9.9h2.3l3.5 2.9a.6.6 0 0 0 1-.5V2.8a.6.6 0 0 0-1-.5z" fill="currentColor" />
                    {previewPlaybackId
                      ? (
                        <path
                          d="m11.4 6.1 3 3.8M14.4 6.1l-3 3.8"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                          fill="none"
                        />
                      )
                      : (
                        <path
                          d="M11.2 5.9a3 3 0 0 1 0 4.2M13.3 4.2a5.6 5.6 0 0 1 0 7.6"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                          fill="none"
                        />
                      )}
                  </svg>
                  <span class="visually-hidden">
                    {isPreviewStarting
                      ? 'Starting preview...'
                      : previewPlaybackId
                        ? 'Stop preview'
                        : 'Preview voice'}
                  </span>
                </button>
              </div>

              {/*
                * Radios rather than a dropdown: the whole catalog of a language
                * stays visible, and each entry can carry its gender mark. The
                * hidden input keeps native arrow-key movement inside the group.
                */}
              <div
                class="voice-grid"
                role="radiogroup"
                aria-label={`${selectedLanguage.label} voice`}
              >
                {selectedLanguage.voices.map((voice) => (
                  <label
                    key={voice.id}
                    class={voice.id === selectedVoiceId
                      ? 'voice-option is-selected'
                      : 'voice-option'}
                  >
                    <input
                      class="voice-option-input"
                      type="radio"
                      name="reading-voice"
                      value={voice.id}
                      aria-label={describeVoice(voice)}
                      checked={voice.id === selectedVoiceId}
                      disabled={isPreviewStarting}
                      onChange={() => void changeVoice(
                        selectedLanguage.languageCode,
                        voice.id
                      )}
                    />
                    <GenderIcon gender={voice.gender} />
                    <span class="voice-option-text">
                      <span class="voice-option-name">{voice.name}</span>
                      {voice.regionLabel
                        ? <span class="voice-option-detail">{voice.regionLabel}</span>
                        : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section class="settings-section" aria-labelledby="translation-settings-title">
        <div class="section-heading">
          <h2 id="translation-settings-title">Translation language</h2>
          <p>
            Selected text is translated into this language. Text already written in
            it is translated into English instead.
          </p>
        </div>

        <label class="select-setting">
          <span>Translate into</span>
          <select
            aria-label="Translation language"
            value={translationLanguage}
            disabled={isLoading}
            onChange={(event) => void changeTranslationLanguage(
              (event.currentTarget as HTMLSelectElement).value
            )}
          >
            {TRANSLATION_TARGET_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section class="settings-section speed-section" aria-labelledby="speed-title">
        <div class="speed-label">
          <h2 id="speed-title">Speaking speed</h2>
          <output>{speed.toFixed(1)}×</output>
        </div>
        <input
          aria-label="Speaking speed"
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={speed}
          disabled={isLoading || isPreviewStarting}
          onChange={(event) => void changeSpeed(
            Number((event.currentTarget as HTMLInputElement).value)
          )}
        />
        <div class="speed-scale" aria-hidden="true">
          <span>Slower</span>
          <span>Faster</span>
        </div>
      </section>

      <p class="save-status" aria-live="polite">{status}</p>
    </>
  )
}

/**
 * The gender mark of one voice entry. It repeats what the radio's label already
 * says, so it is hidden from assistive technology rather than announced twice.
 */
function GenderIcon({ gender }: { gender: VoiceRecord['gender'] }): JSX.Element {
  const className = gender === 'Female'
    ? 'voice-option-icon is-female'
    : gender === 'Male'
      ? 'voice-option-icon is-male'
      : 'voice-option-icon'

  return (
    <svg
      class={className}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      fill="none"
    >
      {gender === 'Female' ? (
        <>
          <circle cx="8" cy="6.2" r="3.4" />
          <path d="M8 9.6v4.6M5.9 12.4h4.2" />
        </>
      ) : gender === 'Male' ? (
        <>
          <circle cx="6.6" cy="9.4" r="3.4" />
          <path d="M9.3 6.7 13.2 2.8M9.9 2.8h3.3v3.3" />
        </>
      ) : (
        <>
          <circle cx="8" cy="5.4" r="2.6" />
          <path d="M3.6 13.6a4.4 4.4 0 0 1 8.8 0" />
        </>
      )}
    </svg>
  )
}

/** The spoken-out description of a voice, used as the radio's label. */
function describeVoice(voice: VoiceOption): string {
  const gender = voice.gender === 'Unknown' ? '' : ` \u00b7 ${voice.gender}`
  const region = voice.regionLabel ? ` (${voice.regionLabel})` : ''
  return `${voice.name}${gender}${region}`
}

/** What the address field's icon currently reports, and why. */
interface KokoroHealth {
  state: KokoroHealthState
  message: string
}

/**
 * One selectable language. Settings are stored per base language, so the picker
 * groups by base language too: offering `en-US` and `en-GB` separately would let
 * the popup show a voice that is not the one actually saved under `en`.
 */
interface VoiceLanguageGroup {
  code: string
  languageCode: string
  label: string
  previewText: string
  voices: VoiceOption[]
}

/** A voice plus the region label needed to tell same-language voices apart. */
interface VoiceOption extends VoiceRecord {
  regionLabel: string | null
}

function groupVoicesByLanguage(
  voices: readonly VoiceRecord[],
  defaults: Readonly<Record<string, string>>
): VoiceLanguageGroup[] {
  const grouped = new Map<string, VoiceRecord[]>()
  for (const voice of voices) {
    const languageCode = voice.locale.toLowerCase().split('-')[0]
    const existing = grouped.get(languageCode)
    if (existing) existing.push(voice)
    else grouped.set(languageCode, [voice])
  }

  return [...grouped.entries()]
    .map(([languageCode, languageVoices]) =>
      createVoiceGroup(languageCode, languageVoices, defaults[languageCode]))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function defaultVoicesFor(engine: TtsEngineId): Readonly<Record<string, string>> {
  return engine === 'kokoro'
    ? DEFAULT_KOKORO_VOICE_BY_LANGUAGE
    : DEFAULT_EDGE_VOICE_BY_LANGUAGE
}

function createFallbackVoiceGroups(engine: TtsEngineId): VoiceLanguageGroup[] {
  const defaults = defaultVoicesFor(engine)
  if (engine === 'kokoro') return groupVoicesByLanguage(KOKORO_FALLBACK_VOICES, defaults)

  const voices: VoiceRecord[] = EDGE_VOICE_LANGUAGES.flatMap(
    (language) => language.voices.map((voice) => ({
      id: voice.id,
      name: voice.name.replace(/ \(.+\)$/u, ''),
      locale: voice.id.split('-').slice(0, 2).join('-'),
      gender: 'Unknown' as const
    }))
  )
  return groupVoicesByLanguage(voices, defaults)
}

function createVoiceGroup(
  languageCode: string,
  voices: readonly VoiceRecord[],
  defaultVoiceId?: string
): VoiceLanguageGroup {
  const previewLanguage = EDGE_VOICE_LANGUAGES.find(
    (language) => language.code === languageCode
  )
  // A region is only worth showing when the language actually has more than one.
  const locales = new Set(voices.map((voice) => voice.locale))
  // Regions stay contiguous, the engine default leads its own region, and that
  // region leads the list, so the recommended voice is the first option.
  const defaultLocale = voices.find((voice) => voice.id === defaultVoiceId)?.locale
  const options = voices
    .map((voice) => ({
      ...voice,
      regionLabel: locales.size > 1 ? displayRegion(voice.locale) : null
    }))
    .sort((left, right) =>
      Number(right.locale === defaultLocale) - Number(left.locale === defaultLocale)
      || left.locale.localeCompare(right.locale)
      || Number(right.id === defaultVoiceId) - Number(left.id === defaultVoiceId)
      || left.name.localeCompare(right.name))

  return {
    code: languageCode,
    languageCode,
    label: displayLanguage(languageCode, 'en') ?? languageCode,
    previewText: previewLanguage?.previewText
      ?? `${displayLanguage(languageCode, languageCode) ?? languageCode}. EchoRead.`,
    voices: options
  }
}

/** Returns the region name of a locale, or null when it carries no region. */
function displayRegion(locale: string): string | null {
  const region = locale.split('-').slice(1).find((part) => /^[A-Za-z]{2}$/u.test(part))
  if (!region) return null

  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase()) ?? null
  } catch {
    return null
  }
}

function displayLanguage(locale: string, displayLocale: string): string | null {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(locale) ?? null
  } catch {
    return null
  }
}

function sendPreviewStop(playbackId: string): Promise<TtsCommandResponse> {
  const request: TtsStopRequest = { action: 'tts:stop', playbackId }
  return chrome.runtime.sendMessage<TtsStopRequest, TtsCommandResponse>(request)
}

function isPreviewPlaybackEvent(message: unknown): message is TtsPlaybackEvent {
  if (typeof message !== 'object' || message === null) return false

  const candidate = message as Record<string, unknown>
  return candidate.action === 'tts:state'
    && typeof candidate.playbackId === 'string'
    && (candidate.state === 'synthesizing'
      || candidate.state === 'playing'
      || candidate.state === 'paused'
      || candidate.state === 'stopped'
      || candidate.state === 'ended')
}
