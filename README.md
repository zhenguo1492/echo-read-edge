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
- **Dictionary lookup** with two sources chosen by your translation target — a
  Chinese target uses Youdao for English–Chinese entries, every other target
  uses the Free Dictionary API for monolingual English. Responses are cached
  locally, so previously looked-up words stay available offline.
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
beside the list, with its meanings, examples, phrases, and pronunciation; the
popup widens to hold both columns and narrows again when you close the entry.

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

#### Platform support

The CPU profile runs on every host below. The GPU profile is NVIDIA-only and, on
top of that, only reachable on two of them. Find your row before following the
setup sections that come after it.

| Host | GPU profile | Why |
| --- | --- | --- |
| Linux + Docker Engine, NVIDIA card | Yes | Driver plus NVIDIA Container Toolkit; see below |
| Linux + Docker Engine, AMD / Intel / no card | No | Image is built against CUDA; no ROCm variant exists |
| Linux + Docker Desktop | No | Containers run in a VM with no host GPU access; use Docker Engine directly |
| Windows + Docker Desktop, WSL2 backend, NVIDIA card | Yes | The only supported path on Windows |
| Windows + Docker Desktop, Hyper-V backend | No | GPU paravirtualization exists only in the WSL2 VM |
| Windows, native Windows containers | N/A | Windows base images only; Kokoro's image is Linux |
| macOS, Apple Silicon | No | VM never gets host GPU access; `linux/arm64` CPU image runs natively |
| macOS, Intel | No | Same VM limit, and no NVIDIA driver since macOS 10.14 |

Two constraints apply everywhere. The images are large — roughly 5 GB on disk
for CPU and 13 GB for GPU — so the first start is a long download. And both
services bind `127.0.0.1:8880`, so only one profile can run at a time on a
given host.

#### Enabling the GPU profile on an NVIDIA host

The GPU profile is NVIDIA-only, and it needs two separate pieces. A working host
driver is not enough on its own: without the container toolkit Docker has no
`nvidia` runtime and the service fails with `could not select device driver
"nvidia" with capabilities: [[gpu]]`.

1. **The NVIDIA driver.** Install it through the distribution's package manager.
   `nvidia-smi` must print your card before continuing.
2. **The NVIDIA Container Toolkit.** This is what registers the `nvidia` runtime
   with Docker so a container can reach the card.

Add the repository and install, on Debian, Ubuntu, and Mint:

```sh
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

Or on RHEL, CentOS, and Fedora:

```sh
curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
  | sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo

sudo dnf install -y nvidia-container-toolkit
```

Then point Docker at the runtime and restart the daemon, on either family:

```sh
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Verify before starting Kokoro. The first command must list `nvidia`, and the
second must report the GPU profile:

```sh
docker info | grep Runtimes
scripts/start-kokoro.sh --check
```

The commands above track the [official install
guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
which also documents how to pin an exact toolkit version and covers the other
supported platforms. The steps above are for a Linux host running Docker Engine
directly; see *macOS and Windows* below for those platforms.

#### Hosts without an NVIDIA GPU

AMD, Intel, and machines with no discrete GPU run the CPU profile, and that is
the whole story: there is no GPU acceleration available to them here. Kokoro
itself is ordinary PyTorch with no CUDA-only operators, but the upstream image
is built against CUDA and ships no ROCm variant, so there is nothing else to
select. Installing the NVIDIA toolkit on such a host does not help either — it
registers a runtime that finds no card.

This matters less than it sounds. Kokoro is an 82M-parameter model and
synthesizes comfortably faster than real time on a modern multi-core CPU, which
is what the reading UI needs: playback stays ahead of the listener after the
first sentence. The CPU image is also the smaller download of the two.

Running it on an AMD card would mean rebuilding the server against a ROCm
PyTorch base image, or moving to an ONNX Runtime build with a ROCm or DirectML
provider. Both are out of scope for this repository.

#### macOS and Windows

Docker Desktop states that "GPU support in Docker Desktop is only available on
Windows with the WSL2 backend". That sentence is about Docker Desktop
specifically; native Docker Engine on Linux, which the previous section covers,
reaches the card directly.

**Windows, with an NVIDIA card.** Three things, none of them the toolkit
installed above:

1. An NVIDIA Windows driver supporting WSL2 GPU paravirtualization. It goes on
   the Windows side, not inside the Linux distribution.
2. An up-to-date WSL2 kernel: `wsl --update`.
3. Docker Desktop with the WSL2 backend enabled, under *Settings > General*.

WSL2 is not optional for this. Linux containers on Windows always run inside a
VM, and NVIDIA's GPU paravirtualization exists only in the WSL2 one, so the
Hyper-V backend has no path to the card at all. Installing WSL2 is usually the
whole fix: `wsl --install` on Windows 10 2004 or later, and on Windows 11, where
it is a standard component. Without an NVIDIA card, or without WSL2, Windows
uses the CPU profile.

Docker Desktop bundles the container-runtime piece, so there is no separate
toolkit step. Do not install a Linux NVIDIA driver inside the WSL distribution:
it overwrites the paravirtualized libraries Windows injects and breaks GPU
access from containers. Running Docker Engine inside WSL2 instead of Docker
Desktop is the one case that does need the toolkit installed in the
distribution — but still not the Linux driver.

**macOS.** There is no GPU profile on any Mac, and nothing can be installed to
create one. Containers run inside a Linux VM that is never given access to the
host GPU, so neither Apple Silicon's integrated GPU nor a discrete card is
reachable; Intel Macs additionally lost NVIDIA driver support in macOS 10.14.
Use the CPU profile. Both images publish `linux/arm64` next to `linux/amd64`,
so Apple Silicon runs the CPU image natively rather than under emulation.

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
- Dictionary lookup split between Youdao and the Free Dictionary API by
  translation target, with a shared local IndexedDB response cache.
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
- [Free Dictionary API](https://dictionaryapi.dev) for monolingual English
  entries, and [Youdao](https://dict.youdao.com) for English–Chinese ones.

Neither Kokoro project is vendored here — the server runs as a separate
container you start yourself. Microsoft, Edge, and Bing are trademarks of
Microsoft Corporation; this project is not affiliated with or endorsed by
Microsoft, and its use of the Edge Read Aloud endpoint is described under
*Edge TTS, the fallback engine* above.
