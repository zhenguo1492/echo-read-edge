import { describe, expect, it } from 'vitest'

import { languageBadge } from './language-badges'

describe('language badges', () => {
  it.each([
    ['en', 'EN', 'English'],
    ['zh', 'CN', 'Chinese'],
    ['ja', 'JP', 'Japanese'],
    ['ko', 'KR', 'Korean'],
    ['fr', 'FR', 'French']
  ])('labels %s as %s', (code, badge, name) => {
    expect(languageBadge(code)).toEqual({ badge, name })
  })

  it('reduces a regional tag to the language it belongs to', () => {
    expect(languageBadge('zh-TW').badge).toBe('CN')
  })

  it('shows an uncovered language by its own code', () => {
    expect(languageBadge('sv')).toEqual({ badge: 'SV', name: 'SV' })
  })

  it('shows a dash for a language nothing has named', () => {
    expect(languageBadge('')).toEqual({ badge: '--', name: 'Unknown' })
  })
})
