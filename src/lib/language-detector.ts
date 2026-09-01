const SCRIPT_LANGUAGES: ReadonlyArray<{
  language: string
  pattern: RegExp
}> = [
  { language: 'ko', pattern: /[\uac00-\ud7af\u1100-\u11ff]/gu },
  { language: 'ar', pattern: /[\u0600-\u06ff\u0750-\u077f]/gu },
  { language: 'hi', pattern: /[\u0900-\u097f]/gu },
  { language: 'ru', pattern: /[\u0400-\u04ff]/gu },
  { language: 'zh', pattern: /[\u3400-\u4dbf\u4e00-\u9fff]/gu }
]

const JAPANESE_KANA_PATTERN = /[\u3040-\u30ff]/gu
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/gu

/**
 * Returns the strongest unambiguous script signal in the supplied text.
 *
 * Translation asks this question of a single selection, where only a script is
 * deterministic enough to act on. A page asks the wider question through
 * {@link detectDominantLanguage}, which has a whole article to answer from.
 */
export function detectScriptLanguage(text: string): string | null {
  const letterCount = text.match(/\p{L}/gu)?.length ?? 0
  if (letterCount === 0) return null

  const kanaCount = countMatches(text, JAPANESE_KANA_PATTERN)
  const hanCount = countMatches(text, HAN_PATTERN)
  const candidates = SCRIPT_LANGUAGES.map((candidate) => ({
    language: candidate.language,
    count: countMatches(text, candidate.pattern)
  }))
  if (kanaCount > 0) {
    // Kanji belongs to the Japanese score once Kana establishes the script.
    candidates.push({ language: 'ja', count: kanaCount + hanCount })
  }

  const strongest = candidates.sort((left, right) => right.count - left.count)[0]
  if (!strongest || strongest.count === 0) return null

  // A lone foreign name or glyph must not override the dominant page language.
  return strongest.count / letterCount >= 0.2 ? strongest.language : null
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/**
 * Function words that identify the Latin-script languages the reader can speak.
 * Scripts answer for themselves; Latin text does not, so the languages sharing
 * that alphabet are separated by the small words every sentence in them repeats.
 */
const LATIN_LANGUAGE_MARKERS: ReadonlyArray<{
  language: string
  words: ReadonlySet<string>
}> = [
  markers('en', 'the and of to in that is for with this are was it on as be have from not you'),
  markers('fr', 'le la les des une un et est dans pour que qui sur avec pas plus ce au du nous'),
  markers('de', 'der die das und ist nicht ein eine den dem mit für auf von sich zu auch wird aber werden'),
  markers('es', 'el la los las de que en y es un una por para con no se del al como más'),
  markers('it', 'il lo la gli che di e è un una per con non si del della sono come più ma'),
  markers('pt', 'o a os as de que do da em para com não uma um por mais como se dos é'),
  markers('nl', 'de het een en van is dat niet op te voor met zijn aan ook maar door naar dit'),
  markers('pl', 'i w nie na się to że z do jest dla przez oraz jak ale po tym tego jego który'),
  markers('tr', 've bir bu için ile olarak daha olan gibi çok en da de ama veya ise kadar sonra ancak her')
]

/** Below this a page has not shown enough prose for word evidence to mean anything. */
const MINIMUM_SAMPLE_WORDS = 12
const MINIMUM_MARKER_MATCHES = 3

/** A winner this close to the runner-up is a guess, and a guess is worse than none. */
const MARKER_MARGIN = 1.3

/**
 * Names the language a passage of running text is written in, or null when the
 * text does not say. Unlike {@link detectScriptLanguage} this also separates the
 * languages that share the Latin alphabet, which is what a page needs before it
 * can be read aloud in its own language.
 *
 * Silence is a real answer here: the caller keeps the reader's own voice rather
 * than switching on a coin flip between two languages that scored alike.
 */
export function detectDominantLanguage(text: string): string | null {
  return detectScriptLanguage(text) ?? detectLatinLanguage(text)
}

function detectLatinLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  if (words.length < MINIMUM_SAMPLE_WORDS) return null

  const scores = LATIN_LANGUAGE_MARKERS.map((candidate) => ({
    language: candidate.language,
    matches: words.filter((word) => candidate.words.has(word)).length
  })).sort((left, right) => right.matches - left.matches)

  const [best, runnerUp] = scores
  if (best.matches < MINIMUM_MARKER_MATCHES) return null
  if (runnerUp && best.matches < runnerUp.matches * MARKER_MARGIN) return null
  return best.language
}

function markers(
  language: string,
  words: string
): { language: string; words: ReadonlySet<string> } {
  return { language, words: new Set(words.split(' ')) }
}
