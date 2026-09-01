import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  TRANSLATION_TARGET_LANGUAGES,
  isTranslationTargetLanguage,
  resolveTranslationTargetLanguage
} from './translation-languages'

describe('TRANSLATION_TARGET_LANGUAGES', () => {
  it('only offers codes the message boundary accepts', () => {
    for (const language of TRANSLATION_TARGET_LANGUAGES) {
      expect(language.code).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u)
      expect(language.label.length).toBeGreaterThan(0)
    }
  })

  it('keeps the legacy Chinese target as the default', () => {
    expect(DEFAULT_TRANSLATION_TARGET_LANGUAGE).toBe('zh-CN')
    expect(isTranslationTargetLanguage(DEFAULT_TRANSLATION_TARGET_LANGUAGE)).toBe(true)
  })

  it('rejects codes outside the offered list', () => {
    expect(isTranslationTargetLanguage('xx')).toBe(false)
    expect(isTranslationTargetLanguage('javascript:alert(1)')).toBe(false)
    expect(isTranslationTargetLanguage(undefined)).toBe(false)
  })
})

describe('resolveTranslationTargetLanguage', () => {
  it('uses the configured target for text written in another script', () => {
    expect(resolveTranslationTargetLanguage('The final focus.', 'zh-CN')).toBe('zh-CN')
    expect(resolveTranslationTargetLanguage('The final focus.', 'ja')).toBe('ja')
    expect(resolveTranslationTargetLanguage('这是一句中文。', 'ja')).toBe('ja')
  })

  it('falls back to English when the text is already in the target language', () => {
    expect(resolveTranslationTargetLanguage('这是一句中文。', 'zh-CN')).toBe('en')
    expect(resolveTranslationTargetLanguage('這是一句中文。', 'zh-TW')).toBe('en')
    expect(resolveTranslationTargetLanguage('한국어 문장입니다.', 'ko')).toBe('en')
  })

  it('keeps a Latin-script target because the script carries no signal', () => {
    expect(resolveTranslationTargetLanguage('Plain English text.', 'fr')).toBe('fr')
    expect(resolveTranslationTargetLanguage('这是一句中文。', 'en')).toBe('en')
  })

  it('ignores a stray glyph instead of switching the whole target', () => {
    expect(
      resolveTranslationTargetLanguage('A long English sentence about 汉 characters.', 'zh-CN')
    ).toBe('zh-CN')
  })

  it('repairs an unsupported stored target', () => {
    expect(resolveTranslationTargetLanguage('The final focus.', 'xx')).toBe('zh-CN')
  })
})
