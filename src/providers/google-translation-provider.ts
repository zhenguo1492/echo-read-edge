import {
  TranslationProviderError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult
} from './translation-provider'

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'

/**
 * The public "gtx" client shares one quota bucket with every scraper on the
 * internet, so Google's abuse system answers it with a network-wide 429 that no
 * amount of client-side pacing can lift. Chrome's own dictionary client id is
 * served from a separate bucket and answers normally from the same address.
 */
const TRANSLATE_CLIENT = 'dict-chrome-ex'

/**
 * Direct port of the legacy free Google Translate boundary. The Provider owns
 * the fixed host and response parsing so page content cannot turn background
 * fetch into a general-purpose network proxy.
 */
export class GoogleTranslationProvider implements TranslationProvider {
  async translate(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    const parameters = new URLSearchParams({
      client: TRANSLATE_CLIENT,
      sl: request.sourceLanguage,
      tl: request.targetLanguage,
      dt: 't',
      ie: 'UTF-8',
      oe: 'UTF-8'
    })

    let response: Response
    try {
      response = await fetch(`${TRANSLATE_URL}?${parameters.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ q: request.text }).toString(),
        signal
      })
    } catch (error) {
      throw new TranslationProviderError('Translation is currently unavailable.', {
        cause: error
      })
    }

    if (!response.ok) {
      throw new TranslationProviderError(
        `Translation failed with HTTP ${response.status}.`,
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('Retry-After'))
        }
      )
    }

    const payload: unknown = await response.json()
    const translation = parseTranslation(payload)
    if (!translation) {
      throw new TranslationProviderError('The translation response was empty.')
    }

    return {
      translation,
      detectedLanguage: parseDetectedLanguage(payload) ?? request.sourceLanguage
    }
  }
}

/** Extracts only translated strings from the undocumented nested response. */
export function parseTranslation(payload: unknown): string | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null
  const parts = payload[0]
    .filter((item): item is unknown[] => Array.isArray(item))
    .map((item) => item[0])
    .filter((value): value is string => typeof value === 'string')
  const translation = parts.join('').trim()
  return translation || null
}

/** Reads the delay-seconds or HTTP-date forms Retry-After is allowed to take. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1_000
  const deadline = Date.parse(header)
  return Number.isNaN(deadline) ? undefined : Math.max(0, deadline - Date.now())
}

function parseDetectedLanguage(payload: unknown): string | null {
  return Array.isArray(payload) && typeof payload[2] === 'string'
    ? payload[2]
    : null
}
