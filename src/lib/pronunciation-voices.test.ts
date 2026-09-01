import { describe, expect, it } from 'vitest'

import type { VoiceRecord } from '@/shared/messages'
import { selectPronunciationVoice, selectPronunciationVoices } from './pronunciation-voices'

const KOKORO: VoiceRecord[] = [
  { id: 'bf_emma', name: 'Emma', locale: 'en-GB', gender: 'Female' },
  { id: 'bm_george', name: 'George', locale: 'en-GB', gender: 'Male' },
  { id: 'af_heart', name: 'Heart', locale: 'en-US', gender: 'Female' },
  { id: 'zf_xiaoxiao', name: 'Xiaoxiao', locale: 'zh-CN', gender: 'Female' }
]

const EDGE: VoiceRecord[] = [
  { id: 'en-AU-NatashaNeural', name: 'Natasha', locale: 'en-AU', gender: 'Female' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', locale: 'en-GB', gender: 'Male' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', locale: 'en-GB', gender: 'Female' },
  { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' }
]

describe('selectPronunciationVoice', () => {
  it('picks a voice of the requested accent from any engine catalog', () => {
    expect(selectPronunciationVoice(KOKORO, 'uk')).toBe('bf_emma')
    expect(selectPronunciationVoice(KOKORO, 'us')).toBe('af_heart')
    expect(selectPronunciationVoice(EDGE, 'uk')).toBe('en-GB-RyanNeural')
    expect(selectPronunciationVoice(EDGE, 'us')).toBe('en-US-AriaNeural')
  })

  it('keeps the reader own voice when it already has that accent', () => {
    expect(selectPronunciationVoice(EDGE, 'uk', 'en-GB-SoniaNeural')).toBe('en-GB-SoniaNeural')
    expect(selectPronunciationVoice(KOKORO, 'uk', 'bm_george')).toBe('bm_george')
  })

  it('ignores a preferred voice that speaks the other accent', () => {
    expect(selectPronunciationVoice(EDGE, 'uk', 'en-US-AriaNeural')).toBe('en-GB-RyanNeural')
    expect(selectPronunciationVoice(KOKORO, 'us', 'bf_emma')).toBe('af_heart')
  })

  it('reports no voice rather than substituting the other accent', () => {
    const americanOnly = KOKORO.filter((voice) => voice.locale === 'en-US')

    expect(selectPronunciationVoice(americanOnly, 'uk')).toBeNull()
    expect(selectPronunciationVoice([], 'us')).toBeNull()
    // A neighbouring English locale is not one of the two offered accents.
    expect(selectPronunciationVoice(
      [{ id: 'en-AU-NatashaNeural', name: 'Natasha', locale: 'en-AU', gender: 'Female' }],
      'uk'
    )).toBeNull()
  })

  it('resolves both accents at once', () => {
    expect(selectPronunciationVoices(KOKORO, 'af_heart')).toEqual({
      uk: 'bf_emma',
      us: 'af_heart'
    })
    expect(selectPronunciationVoices([])).toEqual({ uk: null, us: null })
  })
})
