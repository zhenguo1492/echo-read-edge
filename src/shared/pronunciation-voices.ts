import {
  NO_PRONUNCIATION_VOICES,
  selectPronunciationVoices,
  type PronunciationVoices
} from '@/lib/pronunciation-voices'
import type { VoiceListRequest, VoiceListResponse } from '@/shared/messages'
import { settingsRepository } from '@/storage'

let cached: Promise<PronunciationVoices> | null = null

/**
 * Resolves one UK and one US voice from the active engine's catalog.
 *
 * The result is memoized because a reader opens the dictionary once per word,
 * and dropped whenever stored settings change, which is the only way the engine,
 * its host, or the preferred voice can move.
 */
export function loadPronunciationVoices(): Promise<PronunciationVoices> {
  cached ??= resolvePronunciationVoices()
  return cached
}

/** Exposed for tests and for callers that must not observe a stale catalog. */
export function forgetPronunciationVoices(): void {
  cached = null
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(forgetPronunciationVoices)
}

async function resolvePronunciationVoices(): Promise<PronunciationVoices> {
  try {
    const settings = await settingsRepository.getTtsSettings()
    const request: VoiceListRequest = { action: 'voices:list' }
    const response = await chrome.runtime.sendMessage<VoiceListRequest, VoiceListResponse>(
      request
    )
    if (!response.ok) return NO_PRONUNCIATION_VOICES

    return selectPronunciationVoices(response.voices, settings.voiceByLanguage?.en)
  } catch {
    // A catalog the runtime cannot answer for means no pronunciation button,
    // which is the same outcome as an engine without English voices.
    cached = null
    return NO_PRONUNCIATION_VOICES
  }
}
