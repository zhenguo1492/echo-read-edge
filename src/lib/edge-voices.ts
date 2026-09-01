export interface EdgeVoiceOption {
  id: string
  name: string
}

export interface EdgeVoiceLanguage {
  code: string
  label: string
  previewText: string
  voices: readonly EdgeVoiceOption[]
}

/**
 * A curated fallback used when the dynamic Edge Read Aloud voice list and its
 * local cache are both unavailable.
 */
export const EDGE_VOICE_LANGUAGES: readonly EdgeVoiceLanguage[] = [
  language('ar', 'Arabic', 'مرحبًا بك في EchoRead. هذه معاينة للصوت المحدد.', ['ar-SA-ZariyahNeural', 'Zariyah'], ['ar-SA-HamedNeural', 'Hamed']),
  language('zh', 'Chinese', '欢迎使用 EchoRead。这是所选声音的预览。', ['zh-CN-XiaoxiaoNeural', 'Xiaoxiao'], ['zh-CN-YunxiNeural', 'Yunxi']),
  language('nl', 'Dutch', 'Welkom bij EchoRead. Dit is een voorbeeld van de geselecteerde stem.', ['nl-NL-ColetteNeural', 'Colette'], ['nl-NL-MaartenNeural', 'Maarten']),
  language('en', 'English', 'Welcome to EchoRead. This is a preview of the selected voice.', ['en-US-AriaNeural', 'Aria (United States)'], ['en-US-GuyNeural', 'Guy (United States)'], ['en-GB-SoniaNeural', 'Sonia (United Kingdom)'], ['en-GB-RyanNeural', 'Ryan (United Kingdom)']),
  language('fr', 'French', 'Bienvenue dans EchoRead. Ceci est un aperçu de la voix sélectionnée.', ['fr-FR-DeniseNeural', 'Denise'], ['fr-FR-HenriNeural', 'Henri']),
  language('de', 'German', 'Willkommen bei EchoRead. Dies ist eine Vorschau der ausgewählten Stimme.', ['de-DE-KatjaNeural', 'Katja'], ['de-DE-ConradNeural', 'Conrad']),
  language('hi', 'Hindi', 'EchoRead में आपका स्वागत है। यह चुनी गई आवाज़ का पूर्वावलोकन है।', ['hi-IN-SwaraNeural', 'Swara'], ['hi-IN-MadhurNeural', 'Madhur']),
  language('it', 'Italian', "Benvenuto in EchoRead. Questa è un'anteprima della voce selezionata.", ['it-IT-ElsaNeural', 'Elsa'], ['it-IT-DiegoNeural', 'Diego']),
  language('ja', 'Japanese', 'EchoReadへようこそ。これは選択した音声のプレビューです。', ['ja-JP-NanamiNeural', 'Nanami'], ['ja-JP-KeitaNeural', 'Keita']),
  language('ko', 'Korean', 'EchoRead에 오신 것을 환영합니다. 선택한 음성의 미리 듣기입니다.', ['ko-KR-SunHiNeural', 'Sun-Hi'], ['ko-KR-InJoonNeural', 'InJoon']),
  language('pl', 'Polish', 'Witamy w EchoRead. To jest podgląd wybranego głosu.', ['pl-PL-ZofiaNeural', 'Zofia'], ['pl-PL-MarekNeural', 'Marek']),
  language('pt', 'Portuguese', 'Boas-vindas ao EchoRead. Esta é uma prévia da voz selecionada.', ['pt-BR-FranciscaNeural', 'Francisca'], ['pt-BR-AntonioNeural', 'Antonio']),
  language('ru', 'Russian', 'Добро пожаловать в EchoRead. Это предварительное прослушивание выбранного голоса.', ['ru-RU-SvetlanaNeural', 'Svetlana'], ['ru-RU-DmitryNeural', 'Dmitry']),
  language('es', 'Spanish', 'Te damos la bienvenida a EchoRead. Esta es una vista previa de la voz seleccionada.', ['es-ES-ElviraNeural', 'Elvira'], ['es-ES-AlvaroNeural', 'Alvaro']),
  language('tr', 'Turkish', "EchoRead'e hoş geldiniz. Bu, seçilen sesin bir önizlemesidir.", ['tr-TR-EmelNeural', 'Emel'], ['tr-TR-AhmetNeural', 'Ahmet'])
]

export const DEFAULT_EDGE_VOICE_BY_LANGUAGE: Readonly<Record<string, string>> =
  Object.fromEntries(
    EDGE_VOICE_LANGUAGES.map(({ code, voices }) => [code, voices[0].id])
  )

export function isEdgeVoiceForLanguage(languageCode: string, voiceId: string): boolean {
  return EDGE_VOICE_LANGUAGES.some(
    (language) => language.code === languageCode
      && language.voices.some((voice) => voice.id === voiceId)
  )
}

/** Validates dynamic catalog selections without trusting arbitrary SSML names. */
export function isEdgeVoiceIdForLanguage(languageCode: string, voiceId: string): boolean {
  const match = voiceId.match(/^([a-z]{2,3})(?:-[A-Za-z0-9]+){2,5}Neural$/u)
  return match?.[1] === languageCode
}

function language(
  code: string,
  label: string,
  previewText: string,
  ...voices: ReadonlyArray<readonly [id: string, name: string]>
): EdgeVoiceLanguage {
  return {
    code,
    label,
    previewText,
    voices: voices.map(([id, name]) => ({ id, name }))
  }
}
