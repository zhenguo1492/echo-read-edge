import type { WordBoundary } from '@/providers/tts-provider'

export type AudioCacheKey = string

export const DEFAULT_AUDIO_CACHE_MAX_ENTRIES = 100
export const DEFAULT_AUDIO_CACHE_MAX_BYTES = 64 * 1024 * 1024
export const EDGE_AUDIO_CACHE_VERSION = 'echo-read-edge-tts-cache-v1'
export const EDGE_AUDIO_CACHE_PROVIDER = 'edge-read-aloud'
export const EDGE_AUDIO_CACHE_OUTPUT_FORMAT =
  'audio-24khz-48kbitrate-mono-mp3'

const AUDIO_CONTENT_TYPE = 'audio/mpeg' as const

/** Every value that can change the encoded sentence audio. */
export interface SentenceAudioFingerprint {
  cacheVersion: string
  provider: string
  outputFormat: string
  contentType: typeof AUDIO_CONTENT_TYPE
  voice: string
  rate: string
  text: string
}

export interface SentenceAudioFingerprintInput {
  text: string
  voice: string
  rate: number
  cacheVersion?: string
  provider?: string
  outputFormat?: string
}

export interface SentenceAudioData {
  chunks: readonly Uint8Array[]
  wordBoundaries: readonly WordBoundary[]
}

export interface CachedSentenceAudio extends SentenceAudioData {
  cacheKey: AudioCacheKey
  fingerprint: SentenceAudioFingerprint
  contentType: typeof AUDIO_CONTENT_TYPE
  byteLength: number
  insertedAt: number
}

export interface SentenceAudioCacheOptions {
  maxEntries?: number
  maxBytes?: number
  /**
   * Playing entries and bytes currently being appended to MediaSource cannot be
   * evicted. The callback is evaluated during each bounded eviction pass so the
   * playback session can change protection without mutating cache order.
   */
  isProtected?: (cacheKey: AudioCacheKey) => boolean
}

export type SentenceAudioFactory = (
  cacheKey: AudioCacheKey,
  fingerprint: SentenceAudioFingerprint
) => Promise<SentenceAudioData>

interface InFlightSentenceAudio {
  fingerprint: SentenceAudioFingerprint
  promise: Promise<CachedSentenceAudio>
}

/**
 * Creates the exact Provider-facing fingerprint used by both SHA-256 lookup and
 * collision verification. Trimming here mirrors EdgeTtsProvider before SSML is
 * generated, while String(number) gives one stable JavaScript rate encoding.
 */
export function createSentenceAudioFingerprint(
  input: SentenceAudioFingerprintInput
): SentenceAudioFingerprint {
  const text = input.text.trim()
  const voice = input.voice.trim()
  if (!text) throw new TypeError('Cached sentence text must not be empty.')
  if (!voice) throw new TypeError('Cached sentence voice must not be empty.')
  if (!Number.isFinite(input.rate)) {
    throw new TypeError('Cached sentence rate must be finite.')
  }

  return {
    cacheVersion: input.cacheVersion ?? EDGE_AUDIO_CACHE_VERSION,
    provider: input.provider ?? EDGE_AUDIO_CACHE_PROVIDER,
    outputFormat: input.outputFormat ?? EDGE_AUDIO_CACHE_OUTPUT_FORMAT,
    contentType: AUDIO_CONTENT_TYPE,
    voice,
    rate: String(input.rate),
    text
  }
}

/** Generates a deterministic lowercase hexadecimal SHA-256 cache key. */
export async function createSentenceAudioCacheKey(
  fingerprint: SentenceAudioFingerprint
): Promise<AudioCacheKey> {
  const payload = [
    fingerprint.cacheVersion,
    fingerprint.provider,
    fingerprint.outputFormat,
    fingerprint.voice,
    fingerprint.rate,
    fingerprint.text
  ].join('\0')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

/**
 * In-memory content-addressed FIFO for complete encoded sentence audio. Reads do
 * not delete and reinsert entries, so cache hits never change eviction order.
 * The in-flight map also makes identical concurrent requests share one factory
 * Promise and therefore one Edge WebSocket synthesis job.
 */
export class SentenceAudioCache {
  private readonly entries = new Map<AudioCacheKey, CachedSentenceAudio>()
  private readonly inFlight = new Map<AudioCacheKey, InFlightSentenceAudio>()
  private readonly isProtected: (cacheKey: AudioCacheKey) => boolean
  private generation = 0
  readonly maxEntries: number
  readonly maxBytes: number
  totalBytes = 0

  constructor(options: SentenceAudioCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_AUDIO_CACHE_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_AUDIO_CACHE_MAX_BYTES
    this.isProtected = options.isProtected ?? (() => false)

    if (!Number.isInteger(this.maxEntries) || this.maxEntries <= 0) {
      throw new TypeError('Audio cache maxEntries must be a positive integer.')
    }
    if (!Number.isInteger(this.maxBytes) || this.maxBytes <= 0) {
      throw new TypeError('Audio cache maxBytes must be a positive integer.')
    }
  }

  get size(): number {
    return this.entries.size
  }

  /** Returns keys in their unchanged FIFO insertion order. */
  keys(): AudioCacheKey[] {
    return [...this.entries.keys()]
  }

  /**
   * Returns a hash hit only after comparing the complete fingerprint. A
   * theoretical SHA-256 collision is therefore handled as a normal cache miss.
   */
  getByKey(
    cacheKey: AudioCacheKey,
    fingerprint: SentenceAudioFingerprint
  ): CachedSentenceAudio | undefined {
    const entry = this.entries.get(cacheKey)
    return entry && fingerprintsEqual(entry.fingerprint, fingerprint)
      ? entry
      : undefined
  }

  async get(
    fingerprint: SentenceAudioFingerprint
  ): Promise<CachedSentenceAudio | undefined> {
    const cacheKey = await createSentenceAudioCacheKey(fingerprint)
    return this.getByKey(cacheKey, fingerprint)
  }

  /**
   * Reuses complete or in-progress audio for an identical fingerprint. Factory
   * failures are never cached, so a later request can retry synthesis.
   */
  async getOrCreate(
    fingerprint: SentenceAudioFingerprint,
    factory: SentenceAudioFactory
  ): Promise<CachedSentenceAudio> {
    const generation = this.generation
    const cacheKey = await createSentenceAudioCacheKey(fingerprint)
    if (generation !== this.generation) {
      throw new DOMException(
        'The sentence audio cache was cleared before lookup completed.',
        'AbortError'
      )
    }
    const cached = this.getByKey(cacheKey, fingerprint)
    if (cached) return cached

    const pending = this.inFlight.get(cacheKey)
    if (pending && fingerprintsEqual(pending.fingerprint, fingerprint)) {
      return pending.promise
    }

    const promise = factory(cacheKey, fingerprint).then((data) => {
      if (generation !== this.generation) {
        throw new DOMException(
          'The sentence audio cache was cleared before synthesis completed.',
          'AbortError'
        )
      }
      return this.store(cacheKey, fingerprint, data)
    })
    this.inFlight.set(cacheKey, { fingerprint, promise })

    try {
      return await promise
    } finally {
      const current = this.inFlight.get(cacheKey)
      if (current?.promise === promise) this.inFlight.delete(cacheKey)
      this.evictToLimits()
    }
  }

  delete(cacheKey: AudioCacheKey): boolean {
    const entry = this.entries.get(cacheKey)
    if (!entry) return false

    this.entries.delete(cacheKey)
    this.totalBytes -= entry.byteLength
    return true
  }

  clear(): void {
    this.generation += 1
    this.entries.clear()
    this.inFlight.clear()
    this.totalBytes = 0
  }

  /**
   * Scans at most the Map size captured at the beginning of the pass. This
   * remains bounded even when every over-limit entry is temporarily protected.
   */
  evictToLimits(): AudioCacheKey[] {
    const evicted: AudioCacheKey[] = []
    const initialSize = this.entries.size
    let inspected = 0

    for (const cacheKey of this.entries.keys()) {
      if (!this.isOverLimit() || inspected >= initialSize) break
      inspected += 1

      if (this.inFlight.has(cacheKey) || this.isProtected(cacheKey)) continue
      if (this.delete(cacheKey)) evicted.push(cacheKey)
    }

    return evicted
  }

  private store(
    cacheKey: AudioCacheKey,
    fingerprint: SentenceAudioFingerprint,
    data: SentenceAudioData
  ): CachedSentenceAudio {
    const existing = this.getByKey(cacheKey, fingerprint)
    if (existing) return existing

    // A fingerprint mismatch under the same digest is a collision. Replacing the
    // old value keeps Map lookup unambiguous while ensuring it is never reused.
    this.delete(cacheKey)

    const chunks = data.chunks.map(copyBytes)
    const wordBoundaries = data.wordBoundaries.map(copyWordBoundary)
    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const entry: CachedSentenceAudio = {
      cacheKey,
      fingerprint: { ...fingerprint },
      contentType: AUDIO_CONTENT_TYPE,
      chunks,
      wordBoundaries,
      byteLength,
      insertedAt: Date.now()
    }

    this.entries.set(cacheKey, entry)
    this.totalBytes += byteLength
    this.evictToLimits()
    return entry
  }

  private isOverLimit(): boolean {
    return this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes
  }
}

function fingerprintsEqual(
  left: SentenceAudioFingerprint,
  right: SentenceAudioFingerprint
): boolean {
  return (
    left.cacheVersion === right.cacheVersion &&
    left.provider === right.provider &&
    left.outputFormat === right.outputFormat &&
    left.contentType === right.contentType &&
    left.voice === right.voice &&
    left.rate === right.rate &&
    left.text === right.text
  )
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

function copyWordBoundary(boundary: WordBoundary): WordBoundary {
  return {
    word: boundary.word,
    startTime: boundary.startTime,
    endTime: boundary.endTime
  }
}
