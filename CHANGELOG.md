# Changelog

Notable changes to EchoRead Edge. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts at 2.1.0, the version the project was first published at.
Everything before it was developed without a changelog and without public git
history, so it is summarized as a starting point rather than itemized into
releases.

## [Unreleased]

### Added

- Apache-2.0 license, contribution guide, security policy, and code of conduct.
- GitHub Actions CI running lint, typecheck, tests, and a build on every push
  and pull request.

## [2.1.0] — starting point

The extension as first published: a Chrome Manifest V3 extension with no
account, no login, and no owned backend.

- Reads a page aloud sentence by sentence, with a draggable floating controller
  and active-word highlighting drawn as a non-destructive overlay.
- Two speech engines, switchable in the popup: self-hosted
  [Kokoro](https://github.com/remsky/Kokoro-FastAPI) by default, over the
  captioned-speech route that returns the word timings the highlight needs, and
  direct Microsoft Edge Read Aloud WebSocket synthesis as a zero-setup fallback.
- Automatic reading-language detection, so a page's own text selects the stored
  voice for that language.
- Dictionary lookup split between Youdao and the Free Dictionary API by
  translation target, with a shared local response cache.
- Inline translation of the selected or currently-read sentence.
- Local vocabulary list in IndexedDB, with page context, search, and deletion.
