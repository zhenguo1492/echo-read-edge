import {
  isDictionaryLookupRequest,
  isKokoroHealthRequest,
  isVoiceListRequest,
  isTtsRuntimeEvent,
  isShellPingRequest,
  isTranslateRequest,
  isTtsRequest,
  isVocabularyRequest,
  type DictionaryLookupRequest,
  type DictionaryLookupResponse,
  type KokoroHealthResponse,
  type VoiceListResponse,
  type OffscreenTtsControlRequest,
  type OffscreenTtsRequest,
  type TtsCommandResponse,
  type TtsControlRequest,
  type TtsQueueStartRequest,
  type TtsRequest,
  type TtsRuntimeEvent,
  type TtsStartRequest,
  type TranslateRequest,
  type TranslateResponse,
  type VocabularyRequest,
  type VocabularyResponse
} from '@/shared/messages'
import {
  CachedEdgeVoiceCatalog,
  CachedDictionaryService,
  DictionaryProviderError,
  DictionaryRouter,
  EdgeVoiceListProvider,
  KokoroHealthProbe,
  KokoroVoiceCatalog,
  FreeDictionaryProvider,
  GoogleTranslationProvider,
  ThrottledTranslationProvider,
  WiktionaryDictionaryProvider,
  YoudaoDictionaryProvider
} from '@/providers'
import {
  resolveDictionarySourceIds,
  type DictionarySourceId
} from '@/lib/dictionary-sources'
import {
  ChromeLocalEdgeVoiceCatalogRepository,
  IndexedDbDictionaryCacheRepository,
  settingsRepository,
  vocabularyRepository
} from '@/storage'

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html'
/** Covers a full source walk while still answering the card that is waiting. */
const DICTIONARY_DEADLINE_MS = 20_000
const TRANSLATION_BUDGET_MS = 90_000
/**
 * Every tab's translations funnel through this one instance, so the shared
 * concurrency gate bounds what the extension puts on the wire overall rather
 * than per panel. Google's endpoint answers a burst with an IP-wide abuse
 * block, which no amount of per-panel pacing would avoid.
 */
const translationProvider = new ThrottledTranslationProvider(
  new GoogleTranslationProvider()
)
/**
 * A bilingual source only helps a reader who reads its second language, so the
 * reader's translation target chooses which sources a lookup may walk. Every
 * service shares one cache repository because each provider namespaces its own
 * records.
 */
const dictionaryCache = new IndexedDbDictionaryCacheRepository()
const dictionaryRouter = new DictionaryRouter({
  youdao: new CachedDictionaryService(new YoudaoDictionaryProvider(), dictionaryCache),
  'free-dictionary': new CachedDictionaryService(
    new FreeDictionaryProvider(),
    dictionaryCache
  ),
  wiktionary: new CachedDictionaryService(
    new WiktionaryDictionaryProvider(),
    dictionaryCache
  )
})
const edgeVoiceCatalog = new CachedEdgeVoiceCatalog(
  new EdgeVoiceListProvider(),
  new ChromeLocalEdgeVoiceCatalogRepository()
)

/**
 * Chrome permits only one offscreen document per extension profile. Keeping the
 * in-flight creation Promise here makes simultaneous reading requests converge
 * on the same document instead of racing two createDocument() calls.
 */
let creatingOffscreenDocument: Promise<void> | null = null

/**
 * runtime.sendMessage does not deliver extension-page messages to content
 * scripts. Remembering the originating tab lets the service worker bridge each
 * offscreen state or boundary event with tabs.sendMessage instead.
 */
const playbackOwnerTabs = new Map<string, number>()
let activePrimaryPlaybackId: string | null = null

/**
 * The service worker accepts only same-extension messages. It keeps the shell
 * readiness request synchronous and holds the response channel open only for a
 * validated public TTS command that must cross the offscreen boundary.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false

  if (isShellPingRequest(message)) {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version
    })
    return false
  }

  if (isOffscreenRuntimeEvent(message, sender)) {
    forwardRuntimeEventToOwner(message)
    return false
  }

  if (isVoiceListRequest(message)) {
    void listVoices().then(sendResponse)
    return true
  }

  if (isKokoroHealthRequest(message)) {
    void checkKokoroHealth().then(sendResponse)
    return true
  }

  if (isTranslateRequest(message)) {
    void translateText(message).then(sendResponse)
    return true
  }

  if (isDictionaryLookupRequest(message)) {
    void lookupDictionary(message)
      .catch(() => ({
        ok: false as const,
        code: 'unavailable' as const,
        error: 'The dictionary is currently unavailable.'
      }))
      .then(sendResponse)
    return true
  }

  if (isVocabularyRequest(message)) {
    void routeVocabularyRequest(message).then(sendResponse)
    return true
  }

  if (!isTtsRequest(message)) return false

  void routeTtsRequest(message, sender.tab?.id).then(sendResponse)
  return true
})

async function listVoices(): Promise<VoiceListResponse> {
  const settings = await settingsRepository.getTtsSettings()
  return settings.engine === 'kokoro'
    ? await new KokoroVoiceCatalog(settings.kokoroBaseUrl).list()
    : await edgeVoiceCatalog.list()
}

/**
 * Probes the stored Kokoro address so the settings icon reports on the host the
 * next reading would use. A settings read that fails leaves no address to name,
 * so it is reported as an unreachable server carrying its own reason.
 */
async function checkKokoroHealth(): Promise<KokoroHealthResponse> {
  try {
    const settings = await settingsRepository.getTtsSettings()
    return await new KokoroHealthProbe(settings.kokoroBaseUrl).check()
  } catch (error) {
    return {
      status: 'unreachable',
      baseUrl: '',
      message: error instanceof Error
        ? error.message
        : 'The Kokoro server could not be checked.'
    }
  }
}

/** Executes one fixed-host translation with a bounded service-worker lifetime. */
async function translateText(message: TranslateRequest): Promise<TranslateResponse> {
  // The budget spans queue waiting too, because a long article's last sentence
  // may sit behind every earlier one. Each attempt keeps its own 12s deadline.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TRANSLATION_BUDGET_MS)
  try {
    const result = await translationProvider.translate(message, controller.signal)
    return { ok: true, ...result }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Translation is unavailable.'
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Looks up one validated English word, walking every source the reader can
 * read so a single dead public API does not take the dictionary down with it.
 * The answering source travels with the entry because the card names it.
 *
 * The walk is capped as a whole because a caller that is told nothing shows a
 * spinner forever: storage, not just the network, can stall a lookup.
 */
async function lookupDictionary(
  message: DictionaryLookupRequest
): Promise<DictionaryLookupResponse> {
  try {
    const { entry, source } = await withDeadline(
      resolveActiveDictionarySources()
        .then((sources) => dictionaryRouter.lookup(message.word, sources)),
      DICTIONARY_DEADLINE_MS
    )
    return { ok: true, entry, source }
  } catch (error) {
    if (error instanceof DictionaryProviderError) {
      return { ok: false, code: error.code, error: error.message }
    }
    return {
      ok: false,
      code: 'unavailable',
      error: 'The dictionary is currently unavailable.'
    }
  }
}

/** Rejects rather than letting a stalled dependency hold the response channel. */
function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DictionaryProviderError(
        'unavailable',
        'The dictionary did not answer in time.'
      )),
      timeoutMs
    )
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/** An unreadable setting must not disable lookup, so the default sources stand. */
async function resolveActiveDictionarySources(): Promise<DictionarySourceId[]> {
  try {
    const settings = await settingsRepository.getTranslationSettings()
    return resolveDictionarySourceIds(settings.targetLanguage)
  } catch {
    return resolveDictionarySourceIds(undefined)
  }
}

/**
 * Owns every vocabulary transaction so a content script never opens the
 * database. Each action answers with the resulting saved state of one word.
 */
async function routeVocabularyRequest(
  message: VocabularyRequest
): Promise<VocabularyResponse> {
  try {
    if (message.action === 'vocabulary:save') {
      const saved = await vocabularyRepository.saveWord(message)
      return { ok: true, saved: true, savedAt: saved.createdAt }
    }

    if (message.action === 'vocabulary:remove') {
      await vocabularyRepository.removeWordByName(message.word)
      return { ok: true, saved: false }
    }

    const existing = await vocabularyRepository.getWord(message.word)
    return existing
      ? { ok: true, saved: true, savedAt: existing.createdAt }
      : { ok: true, saved: false }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? error.message
        : 'The vocabulary list could not be updated.'
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void disposePlaybackOwnedByTab(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url !== undefined) {
    void disposePlaybackOwnedByTab(tabId)
  }
})

/**
 * Converts the page-facing allowlisted request into the private offscreen
 * protocol. Callers can provide synthesis values or a playback ID, but cannot
 * choose a runtime target, network URL, or provider protocol field.
 */
async function routeTtsRequest(
  message: TtsRequest,
  senderTabId?: number
): Promise<TtsCommandResponse> {
  try {
    if (message.action === 'tts:start' || message.action === 'tts:start-queue') {
      return await startPrimaryPlayback(message, senderTabId)
    }

    return await routePlaybackControl(message, senderTabId)
  } catch (error) {
    return runtimeUnavailable(error)
  }
}

/** Creates one primary session after disposing the previous global session. */
async function startPrimaryPlayback(
  message: TtsStartRequest | TtsQueueStartRequest,
  senderTabId?: number
): Promise<TtsCommandResponse> {
  // AUDIO_PLAYBACK documents may close after an idle period, so every new
  // synthesis checks and recreates the document before message delivery.
  await ensureOffscreenDocument()
  await disposeActivePrimaryPlayback()

  const playbackId = crypto.randomUUID()
  activePrimaryPlaybackId = playbackId
  if (senderTabId !== undefined) playbackOwnerTabs.set(playbackId, senderTabId)

  // The engine and its host are resolved here so the hidden runtime never has to
  // trust a synthesis target chosen by a content script or the popup.
  const settings = await settingsRepository.getTtsSettings()
  const engineTarget = {
    engine: settings.engine,
    kokoroBaseUrl: settings.kokoroBaseUrl
  }

  const offscreenMessage: OffscreenTtsRequest =
    message.action === 'tts:start'
      ? {
          target: 'offscreen',
          action: 'offscreen:tts:start',
          playbackId,
          text: message.text,
          voice: message.voice,
          rate: message.rate,
          ...engineTarget
        }
      : {
          target: 'offscreen',
          action: 'offscreen:tts:start-queue',
          playbackId,
          sentences: [...message.sentences],
          voice: message.voice,
          rate: message.rate,
          ...engineTarget,
          ...(message.startIndex === undefined
            ? {}
            : { startIndex: message.startIndex })
        }

  try {
    const response = await sendToOffscreen(offscreenMessage)
    if (!response.ok) releasePlaybackOwnership(playbackId)
    return response
  } catch (error) {
    releasePlaybackOwnership(playbackId)
    throw error
  }
}

/** Validates tab ownership before forwarding one explicitly mapped control. */
async function routePlaybackControl(
  message: TtsControlRequest,
  senderTabId?: number
): Promise<TtsCommandResponse> {
  // Chrome keeps the AUDIO_PLAYBACK document alive across a service worker
  // restart, which empties the records below while a session is still audible.
  // Teardown is therefore forwarded on the tab's word alone: only the hidden
  // document can tell a stale playback ID from the one it is still speaking,
  // and refusing here would leave that audio with nothing able to stop it.
  if (
    activePrimaryPlaybackId !== message.playbackId &&
    message.action !== 'tts:dispose'
  ) {
    return invalidRequest('The requested playback session is no longer active.')
  }

  const ownerTabId = playbackOwnerTabs.get(message.playbackId)
  if (
    ownerTabId !== undefined &&
    senderTabId !== undefined &&
    senderTabId !== ownerTabId
  ) {
    return invalidRequest('The requested playback session belongs to another tab.')
  }

  const offscreenMessage = toOffscreenControlRequest(message)
  if (message.action !== 'tts:dispose') {
    return await sendToOffscreen(offscreenMessage)
  }

  try {
    return await sendToOffscreen(offscreenMessage)
  } finally {
    releasePlaybackOwnership(message.playbackId)
  }
}

/** Keeps the public-to-private action mapping exhaustive and payload-safe. */
function toOffscreenControlRequest(
  message: TtsControlRequest
): OffscreenTtsControlRequest {
  switch (message.action) {
    case 'tts:pause':
      return offscreenBasicControl('offscreen:tts:pause', message.playbackId)
    case 'tts:resume':
      return offscreenBasicControl('offscreen:tts:resume', message.playbackId)
    case 'tts:stop':
      return offscreenBasicControl('offscreen:tts:stop', message.playbackId)
    case 'tts:previous':
      return offscreenBasicControl('offscreen:tts:previous', message.playbackId)
    case 'tts:next':
      return offscreenBasicControl('offscreen:tts:next', message.playbackId)
    case 'tts:play-sentence':
      return {
        target: 'offscreen',
        action: 'offscreen:tts:play-sentence',
        playbackId: message.playbackId,
        sentenceIndex: message.sentenceIndex
      }
    case 'tts:dispose':
      return offscreenBasicControl('offscreen:tts:dispose', message.playbackId)
  }
}

function offscreenBasicControl(
  action:
    | 'offscreen:tts:pause'
    | 'offscreen:tts:resume'
    | 'offscreen:tts:stop'
    | 'offscreen:tts:previous'
    | 'offscreen:tts:next'
    | 'offscreen:tts:dispose',
  playbackId: string
): OffscreenTtsControlRequest {
  return { target: 'offscreen', action, playbackId }
}

/** Forwards offscreen events only to the content tab that created the playback. */
function forwardRuntimeEventToOwner(event: TtsRuntimeEvent): void {
  if (event.playbackId !== activePrimaryPlaybackId) return

  const tabId = playbackOwnerTabs.get(event.playbackId)
  if (tabId === undefined) return

  void chrome.tabs.sendMessage<TtsRuntimeEvent, unknown>(tabId, event).catch(() => {
    // The tab may have navigated or closed; offscreen playback remains isolated.
  })
}

/**
 * Prevents a content script from impersonating the trusted offscreen event
 * source before its state is forwarded into another tab context.
 */
function isOffscreenRuntimeEvent(
  message: unknown,
  sender: chrome.runtime.MessageSender
): message is TtsRuntimeEvent {
  if (sender.url !== chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)) return false
  return isTtsRuntimeEvent(message)
}

/** Disposes the previous primary session before any replacement starts. */
async function disposeActivePrimaryPlayback(): Promise<void> {
  const playbackId = activePrimaryPlaybackId
  if (!playbackId) return

  releasePlaybackOwnership(playbackId)
  try {
    await sendToOffscreen(
      offscreenBasicControl('offscreen:tts:dispose', playbackId)
    )
  } catch {
    // Starting the replacement remains safe when Chrome already closed the old
    // offscreen document because no old runtime resources can still survive.
  }
}

/** Releases a session when its owning content tab closes or begins navigation. */
async function disposePlaybackOwnedByTab(tabId: number): Promise<void> {
  const ownedPlaybackIds = [...playbackOwnerTabs.entries()]
    .filter(([, ownerTabId]) => ownerTabId === tabId)
    .map(([playbackId]) => playbackId)

  for (const playbackId of ownedPlaybackIds) {
    releasePlaybackOwnership(playbackId)
    try {
      await sendToOffscreen(
        offscreenBasicControl('offscreen:tts:dispose', playbackId)
      )
    } catch {
      // Ownership cleanup is complete even if the hidden document is already gone.
    }
  }
}

function releasePlaybackOwnership(playbackId: string): void {
  playbackOwnerTabs.delete(playbackId)
  if (activePrimaryPlaybackId === playbackId) activePrimaryPlaybackId = null
}

function invalidRequest(message: string): TtsCommandResponse {
  return {
    ok: false,
    error: { code: 'invalid-request', message }
  }
}

function runtimeUnavailable(error: unknown): TtsCommandResponse {
  return {
    ok: false,
    error: {
      code: 'runtime-unavailable',
      message:
        error instanceof Error
          ? error.message
          : 'The hidden audio runtime is unavailable.'
    }
  }
}

/** Returns whether the fixed production offscreen page is currently alive. */
async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  })
  return contexts.length > 0
}

/**
 * Creates the fixed hidden audio runtime once and waits until Chrome completes
 * creation before allowing a synthesis message to be sent to its listener.
 */
async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument
    return
  }

  const creation = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Synthesize and play Microsoft Edge Read Aloud audio.'
  })
  creatingOffscreenDocument = creation

  try {
    await creation
  } finally {
    // Clear only the Promise owned by this invocation so a future recreation is
    // possible even when Chrome rejected the current creation attempt.
    if (creatingOffscreenDocument === creation) creatingOffscreenDocument = null
  }
}

/** Sends one already-sanitized command to the extension-owned hidden page. */
function sendToOffscreen(message: OffscreenTtsRequest): Promise<TtsCommandResponse> {
  return chrome.runtime.sendMessage<OffscreenTtsRequest, TtsCommandResponse>(message)
}
