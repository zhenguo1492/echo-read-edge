import { describe, expect, it } from 'vitest'

import { detectDominantLanguage, detectScriptLanguage } from './language-detector'

describe('script language detection', () => {
  it.each([
    ['\u8fd9\u662f\u4e2d\u6587\u3002', 'zh'],
    ['\u6f22\u5b57\u3068\u3072\u3089\u304c\u306a\u3002', 'ja'],
    ['\ud55c\uad6d\uc5b4 \ubb38\uc7a5\u3002', 'ko'],
    ['\u041f\u0440\u0438\u0432\u0435\u0442.', 'ru'],
    ['\u092f\u0939 \u092a\u093e\u0920\u0964', 'hi'],
    ['\u0627\u0642\u0631\u0623.', 'ar']
  ])('detects an unambiguous Unicode script in %s', (text, language) => {
    expect(detectScriptLanguage(text)).toBe(language)
  })

  it('does not let one embedded Han character override Latin text', () => {
    expect(detectScriptLanguage('The character \u4e2d appears in this English sentence.')).toBeNull()
  })

  it('reports no script language for Latin text', () => {
    expect(detectScriptLanguage('Bonjour, ceci est un article en francais.')).toBeNull()
  })
})

describe('dominant language detection', () => {
  it.each([
    ['\u8fd9\u662f\u4e00\u7bc7\u4e2d\u6587\u6587\u7ae0\uff0c\u5b83\u4ecb\u7ecd\u4e86\u9605\u8bfb\u6269\u5c55\u7684\u529f\u80fd\u3002', 'zh'],
    ['\u3053\u308c\u306f\u65e5\u672c\u8a9e\u306e\u8a18\u4e8b\u3067\u3059\u3002\u62e1\u5f35\u6a5f\u80fd\u3092\u7d39\u4ecb\u3057\u307e\u3059\u3002', 'ja']
  ])('keeps the script answer for %s', (text, language) => {
    expect(detectDominantLanguage(text)).toBe(language)
  })

  it('detects English prose that carries no script signal', () => {
    expect(
      detectDominantLanguage(
        'The extension reads the page aloud and highlights the sentence that is '
          + 'being spoken, so the reader can follow along with the text.'
      )
    ).toBe('en')
  })

  it('detects French prose that carries no script signal', () => {
    expect(
      detectDominantLanguage(
        "L'extension lit la page a voix haute et met en evidence la phrase qui "
          + 'est prononcee, pour que le lecteur puisse suivre le texte.'
      )
    ).toBe('fr')
  })

  it('detects German prose that carries no script signal', () => {
    expect(
      detectDominantLanguage(
        'Die Erweiterung liest die Seite vor und hebt den Satz hervor, der '
          + 'gerade gesprochen wird, damit der Leser dem Text folgen kann.'
      )
    ).toBe('de')
  })

  it('detects Spanish prose that carries no script signal', () => {
    expect(
      detectDominantLanguage(
        'La extension lee la pagina en voz alta y resalta la frase que se esta '
          + 'pronunciando, para que el lector pueda seguir el texto.'
      )
    ).toBe('es')
  })

  it('reports nothing for a fragment too short to carry evidence', () => {
    expect(detectDominantLanguage('Read aloud')).toBeNull()
  })

  it('reports nothing for text without words', () => {
    expect(detectDominantLanguage('  1234 :: 5678  ')).toBeNull()
  })
})
