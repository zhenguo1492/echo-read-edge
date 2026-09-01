import { describe, expect, it } from 'vitest'

import { selectReadingVoice } from './reading-voice'
import type { TTSSettings } from '@/types'

const settings: TTSSettings = {
  engine: 'edge',
  kokoroBaseUrl: 'http://127.0.0.1:8880',
  voice: 'en-US-AriaNeural',
  voiceLanguage: 'en',
  voiceByLanguage: {
    en: 'en-US-AriaNeural',
    ja: 'ja-JP-NanamiNeural',
    zh: 'zh-CN-XiaoxiaoNeural'
  },
  speed: 1.25
}

describe('reading voice selection', () => {
  it('speaks a detected page language with the voice stored for it', () => {
    expect(selectReadingVoice(settings, 'ja')).toEqual({
      voice: 'ja-JP-NanamiNeural',
      speed: 1.25
    })
  })

  it('accepts a regional tag for a language whose voice is stored by base code', () => {
    expect(selectReadingVoice(settings, 'zh-TW').voice).toBe('zh-CN-XiaoxiaoNeural')
  })

  it('keeps the reader’s chosen voice when the page language is unknown', () => {
    expect(selectReadingVoice(settings, null).voice).toBe('en-US-AriaNeural')
  })

  it('keeps the reader’s chosen voice when the engine has no voice for the page', () => {
    expect(selectReadingVoice(settings, 'ko').voice).toBe('en-US-AriaNeural')
  })

  it('keeps the reader’s chosen voice when the engine reported no voice map', () => {
    const withoutMap: TTSSettings = { ...settings, voiceByLanguage: undefined }
    expect(selectReadingVoice(withoutMap, 'ja').voice).toBe('en-US-AriaNeural')
  })
})
