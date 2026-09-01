import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KOKORO_BASE_URL,
  DEFAULT_TTS_ENGINE,
  isTtsEngineId,
  normalizeKokoroBaseUrl,
  TTS_ENGINES
} from './tts-engines'

describe('tts engines', () => {
  it('defaults to the self-hosted engine', () => {
    expect(DEFAULT_TTS_ENGINE).toBe('kokoro')
    expect(TTS_ENGINES.map((engine) => engine.id)).toEqual(['kokoro', 'edge'])
    expect(normalizeKokoroBaseUrl(DEFAULT_KOKORO_BASE_URL)).toBe(DEFAULT_KOKORO_BASE_URL)
  })

  it('accepts only engine identifiers the extension implements', () => {
    expect(isTtsEngineId('kokoro')).toBe(true)
    expect(isTtsEngineId('edge')).toBe(true)
    expect(isTtsEngineId('azure')).toBe(false)
    expect(isTtsEngineId(undefined)).toBe(false)
  })

  it('normalizes a host by dropping the trailing slash', () => {
    expect(normalizeKokoroBaseUrl('http://127.0.0.1:8880/')).toBe('http://127.0.0.1:8880')
    expect(normalizeKokoroBaseUrl('  https://kokoro.lan/tts/  ')).toBe('https://kokoro.lan/tts')
  })

  it('rejects hosts that would change how the endpoint URL is built', () => {
    expect(normalizeKokoroBaseUrl('ws://localhost:8880')).toBeNull()
    expect(normalizeKokoroBaseUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeKokoroBaseUrl('http://user:pass@localhost:8880')).toBeNull()
    expect(normalizeKokoroBaseUrl('http://localhost:8880/?token=1')).toBeNull()
    expect(normalizeKokoroBaseUrl('localhost:8880')).toBeNull()
    expect(normalizeKokoroBaseUrl('')).toBeNull()
    expect(normalizeKokoroBaseUrl(8880)).toBeNull()
  })
})
