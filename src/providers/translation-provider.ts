export interface TranslationRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
}

export interface TranslationResult {
  translation: string
  detectedLanguage: string
}

export interface TranslationProvider {
  translate(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult>
}

export interface TranslationProviderErrorOptions extends ErrorOptions {
  /** HTTP status when the failure came from a response rather than the socket. */
  status?: number
  /** Server-requested delay parsed from Retry-After, when it sent one. */
  retryAfterMs?: number
}

/**
 * Carries the status so callers can tell back-pressure apart from a permanent
 * failure. Without it every failure looks equally final and retrying a rate
 * limit is indistinguishable from retrying a malformed request.
 */
export class TranslationProviderError extends Error {
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(message: string, options?: TranslationProviderErrorOptions) {
    super(message, options)
    this.name = 'TranslationProviderError'
    this.status = options?.status
    this.retryAfterMs = options?.retryAfterMs
  }
}
