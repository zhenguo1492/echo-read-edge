import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KOKORO_VOICE_BY_LANGUAGE,
  isKokoroVoiceId,
  isKokoroVoiceIdForLanguage,
  KOKORO_FALLBACK_VOICES,
  kokoroVoiceLanguage,
  toKokoroVoiceRecord
} from './kokoro-voices'

describe('kokoro voices', () => {
  it('derives locale, gender, and display name from an identifier', () => {
    expect(toKokoroVoiceRecord('af_heart')).toEqual({
      id: 'af_heart',
      name: 'Heart',
      locale: 'en-US',
      gender: 'Female'
    })
    expect(toKokoroVoiceRecord('bm_george')).toEqual({
      id: 'bm_george',
      name: 'George',
      locale: 'en-GB',
      gender: 'Male'
    })
    expect(toKokoroVoiceRecord('zf_xiaoxiao')?.locale).toBe('zh-CN')
  })

  it('rejects identifiers that are not Kokoro voices', () => {
    expect(toKokoroVoiceRecord('en-US-AriaNeural')).toBeNull()
    expect(toKokoroVoiceRecord('af_heart(2)+af_sky(1)')).toBeNull()
    expect(toKokoroVoiceRecord('xf_ghost')).toBeNull()
    expect(isKokoroVoiceId('../etc/passwd')).toBe(false)
    expect(isKokoroVoiceId('af_heart')).toBe(true)
  })

  it('maps both English locales onto one language selection', () => {
    expect(kokoroVoiceLanguage('af_heart')).toBe('en')
    expect(kokoroVoiceLanguage('bf_emma')).toBe('en')
    expect(isKokoroVoiceIdForLanguage('en', 'bf_emma')).toBe(true)
    expect(isKokoroVoiceIdForLanguage('en', 'zf_xiaoxiao')).toBe(false)
    expect(isKokoroVoiceIdForLanguage('zh', 'zf_xiaoxiao')).toBe(true)
  })

  it('provides one usable default per shipped language', () => {
    expect(DEFAULT_KOKORO_VOICE_BY_LANGUAGE.en).toBe('af_heart')
    expect(DEFAULT_KOKORO_VOICE_BY_LANGUAGE.zh).toBe('zf_xiaoxiao')
    expect(Object.keys(DEFAULT_KOKORO_VOICE_BY_LANGUAGE).sort())
      .toEqual(['en', 'es', 'fr', 'hi', 'it', 'ja', 'pt', 'zh'])
    for (const [languageCode, voiceId] of Object.entries(DEFAULT_KOKORO_VOICE_BY_LANGUAGE)) {
      expect(isKokoroVoiceIdForLanguage(languageCode, voiceId)).toBe(true)
    }
  })

  it('keeps every fallback voice normalizable', () => {
    expect(KOKORO_FALLBACK_VOICES.length).toBeGreaterThan(40)
    for (const voice of KOKORO_FALLBACK_VOICES) {
      expect(isKokoroVoiceId(voice.id)).toBe(true)
      expect(voice.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/u)
    }
  })
})
