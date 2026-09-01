# EchoRead Edge

EchoRead Edge is a Chrome Manifest V3 extension that reads web pages aloud,
highlights the word it is currently speaking, and turns any word you click into
a dictionary entry you can save. It runs entirely on your machine: there is no
account, no login, and no EchoRead-owned backend. Speech comes from a Kokoro
server you host yourself, or from Microsoft Edge Read Aloud as a zero-setup
fallback. Vocabulary and dictionary caches live in the browser's IndexedDB.

## Features

- **Read a page aloud** sentence by sentence, with a draggable floating
  controller for play, pause, stop, and previous/next sentence.
- **Active-word highlighting** driven by word timings returned with the audio,
  drawn as a non-destructive overlay that never rewrites the page DOM.
- **Click to listen.** Plain click starts reading from the sentence you clicked.
  Alt+click selects a sentence, Shift+click a paragraph, Ctrl+click a word.
- **Selection toolbar** on any text you select: read it, translate it, or open
  the dictionary card.
- **Dictionary lookup** with sources chosen by your translation target — a
  Chinese target uses Youdao for English–Chinese entries, every other target
  uses the Free Dictionary API for monolingual English and falls back to
  Wiktionary when that API is down. An inflected word such as “billions” is
  resolved to its base form when a source indexes headwords only. Responses are
  cached locally, so previously looked-up words stay available offline.
- **Inline translation** of the selected or currently-read sentence, into a
  target language you pick in the popup.
- **Local vocabulary list** in the popup: saved words with their page context,
  searchable and deletable, stored in IndexedDB. Clicking a saved word opens its
  dictionary entry in a second column beside the list.
- **Automatic reading language.** Opening a page detects the language its text
  is written in and reads it with the voice you stored for that language, so a
  Japanese article is not read by an English voice. The floating controller's
  top mark names it — EN, CN, JP — and picking a language in the popup while the
  page is open overrides the detection for that page.
- **Two speech engines**, switchable in the popup, with per-language voice
  selection, a playback-speed control, and a voice preview button.

## Install into Chrome

The extension is not on the Web Store; you load it unpacked from a local build.
You need Node.js 18.18+ and Yarn 4 (`corepack enable` is enough — the version is
pinned in `package.json`).

```sh
yarn install
yarn build        # writes the unpacked extension to output/
```

Then, in Chrome (or any Chromium browser, version 116 or newer):

1. Open `chrome://extensions`.
2. Turn on **Developer mode**, top right.
3. Click **Load unpacked** and select this repository's `output/` directory.
4. Pin **EchoRead Edge** to the toolbar so the popup is one click away.

Rebuild with `yarn build` after changing the source, then press the reload arrow
on the extension card. `yarn dev` builds in development mode and keeps watching
for changes; you still press reload in Chrome to pick them up.

`yarn build:zip` packs the same output into `echo-read-edge.zip`, which is only
useful for handing the build to someone else — Chrome still wants an unpacked
directory, so the recipient unzips it and follows the steps above.

## Using it

**Read a whole page.** Open the popup and start reading, or just click a
sentence on the page: reading begins there and continues forward. The floating
controller appears while a session is active. Drag it anywhere, collapse it when
it is in the way, or hide it entirely under *Settings* in the popup.

**Read part of a page.** Select text and use the toolbar that appears next to
it. Or hold a modifier and click: Alt for the sentence under the pointer, Shift
for the whole paragraph, Ctrl for a single word.

**Look a word up.** Ctrl+click a word, or select it and press the dictionary
button. The card shows the definition, the source that answered, and a button
that saves the word together with the sentence it appeared in.

**Manage saved words.** The popup's *Words* tab lists everything you saved,
with search and per-word deletion. Click a word to open its dictionary entry
beside the list: the same panel the page shows, with the same tabs, UK and US
pronunciation, and per-example playback. The popup widens to hold both columns
and narrows again when you close the entry.

**Change voices and speed.** The popup's *Settings* tab holds the speech engine,
the Kokoro server address, a voice per language, playback speed, the translation
target language, and the floating-controller toggle. Changes are saved as you
make them.

**Read a page in another language.** Nothing to do: the page's own text decides
which of your stored voices reads it, and the mark at the top of the floating
controller says which language that is — hover it for the full name. The detection uses the article rather than
the surrounding navigation, and stays silent when the text does not clearly name
a language — then the voice from *Settings* reads, exactly as before. Choosing a
language or a voice in the popup while a page is open is treated as the last
word and turns detection off for that page until it is reloaded.

## Architecture

The whole system is the extension. A content script owns everything that touches
the page, an MV3 service worker owns every network call and every write to
storage, an offscreen document owns the audio clock, and the popup owns
settings and the vocabulary UI. The content script never learns which speech
engine is selected — it sends text, a voice, and a rate.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime responsibilities,
  module boundaries, storage and security boundaries, and how each external
  service is allowed to fail.
- [docs/TTS_DATA_FLOW.md](docs/TTS_DATA_FLOW.md) — the reading pipeline in
  detail: the target queue, session ownership, chunking, prefetch, the audio
  cache and its eviction, word-boundary events, and cancellation.
- [docs/HELP.md](docs/HELP.md) — the user-facing speech-engine guide, rendered
  into the extension's help page at build time.

The project started as a migration from an earlier, backend-backed version of
EchoRead; that history is what the module boundaries above are shaped by. The
predecessor is not public, and nothing in this repository depends on it.

## Speech engines

Two engines are selectable in the popup, and they trade setup against
dependability.

| | Kokoro (default) | Edge Read Aloud |
| --- | --- | --- |
| Runs | On your machine, in Docker | On Microsoft's servers |
| Setup | One `docker compose` start, a multi-GB image | None |
| Privacy | Text never leaves the host | Every sentence is sent to Microsoft |
| Suitable for | Everyday use | Trying the extension out, or a broken local server |

### Kokoro, the local engine

The default engine is [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), an
82M-parameter open-weights TTS model, served by
[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI). The extension calls
its captioned-speech route, which returns word timings alongside the MP3 — that
is what keeps the active-word highlight working.

Start it from this repository before reading:

```sh
scripts/start-kokoro.sh   # detect GPU support, then start the matching profile
```

The script picks the GPU profile only when the host has both a working NVIDIA
driver and the NVIDIA Container Toolkit, and otherwise falls back to CPU with a
line explaining which of the two is missing. `--check` reports the decision
without starting anything; `--gpu` and `--cpu` override it. Because the two
services collide on port 8880, the script removes a container left over from the
other profile before starting.

The profiles can also be driven directly:

```sh
docker compose up -d                 # CPU
docker compose --profile gpu up -d   # NVIDIA
```

Exactly one of the two may run: both publish 8880. Switching between them needs
`docker compose down` first, because `up` does not stop a service the newly
selected profile no longer contains.

The server listens on `127.0.0.1:8880`, which is the address the extension ships
as its default; change it under *Speech engine* in the popup if you run it
elsewhere. The popup probes that address and marks it with a health indicator.
When no server answers, the popup falls back to the built-in voice list and
playback reports a connection error rather than silently switching engines.

#### Running it without this repository

Someone running the extension has the popup, not this checkout, so the setup
they need — installing Docker, the compose file to copy, the start-to-finish
steps, the GPU platform matrix, and the NVIDIA Container Toolkit instructions —
lives in [docs/HELP.md](docs/HELP.md). That file is also the source the build
renders into the help page behind the popup's *Help* button, so it is the one
place to edit when any of it changes.

### Edge TTS, the fallback engine

"Edge TTS" is the speech service behind Microsoft Edge's *Read Aloud* feature.
It is the same neural voice catalog Azure Speech sells, reached over a
WebSocket at `speech.platform.bing.com` that the browser's Read Aloud UI uses
without an API key. The extension speaks that protocol directly: it opens the
socket in the service worker, sends SSML, and receives MP3 frames plus
WordBoundary events — the same word timings the highlight needs. A Declarative
Net Request rule rewrites `User-Agent` and `Origin` on that one WebSocket so the
handshake is accepted; the rule matches only that host and only the `websocket`
resource type, and never touches ordinary page requests.

Select it under *Speech engine* in the popup. It needs no setup at all, which is
the point: it is there so the extension works before you have pulled a 5 GB
image, and when your local server is down.

Use it in moderation. This endpoint is not a public API — Microsoft does not
document or support third-party use of it, applies no key and therefore no
quota, and can change or block it at any time. Every sentence you read is sent
to Microsoft, so nothing you would not paste into a Microsoft product should go
through it. Treat it as a way to try things out, not as the engine you leave
selected: the local Kokoro server is the one meant for everyday reading, and it
keeps your text on your own machine.

When Edge is unavailable, the popup falls back to the built-in voice list, the
handshake failure is reported instead of retried forever, and reading stops
rather than looping.

## Development

```sh
yarn dev         # development build, then rebuild on change
yarn lint        # ESLint, zero warnings tolerated
yarn typecheck   # tsc --noEmit
yarn test        # Vitest
```

`scripts/verify-edge-tts.ts` drives a real Edge Read Aloud handshake in a
throwaway Chrome profile, which is how a protocol change gets caught without
loading the extension by hand.

## Current decisions

- Chrome Manifest V3 extension with no owned backend.
- No login or cloud synchronization.
- Self-hosted Kokoro synthesis by default, over the captioned-speech route so
  word highlighting keeps working.
- Direct Edge Read Aloud WebSocket synthesis as the optional second engine.
- Dictionary lookup split between Youdao, the Free Dictionary API, and
  Wiktionary by translation target, with a shared local IndexedDB response
  cache. Each source gets its own request budget, and one that fails to answer
  is passed over for five minutes.
- Direct selected-text translation without an EchoRead account.
- `chrome.storage.local` for settings and small metadata.
- IndexedDB for vocabulary, occurrences, and dictionary cache records.
- Storage access is isolated behind repository interfaces.
- SQLite is not part of the first implementation.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, the checks a pull request
has to pass, and the house rules. Security issues go through
[SECURITY.md](SECURITY.md) rather than the public issue tracker.

## Acknowledgements

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), the open-weights TTS
  model the default engine speaks with. Apache-2.0.
- [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) by remsky, the
  server the extension calls and the image `docker-compose.yml` pulls.
  Apache-2.0.
- [Free Dictionary API](https://dictionaryapi.dev) and
  [Wiktionary](https://en.wiktionary.org) for monolingual English entries, and
  [Youdao](https://dict.youdao.com) for English–Chinese ones. Wiktionary content
  is licensed CC BY-SA 4.0.

Neither Kokoro project is vendored here — the server runs as a separate
container you start yourself. Microsoft, Edge, and Bing are trademarks of
Microsoft Corporation; this project is not affiliated with or endorsed by
Microsoft, and its use of the Edge Read Aloud endpoint is described under
*Edge TTS, the fallback engine* above.
