# Security Policy

## Reporting a vulnerability

Report security issues privately through GitHub's **Report a vulnerability**
button under this repository's *Security* tab, which opens a private advisory
only the maintainers can read. Please do not open a public issue for anything
exploitable.

Include what an attacker can reach, the steps to reproduce it, and the affected
version. Expect an acknowledgement within a week.

## What is in scope

The extension has no server component, no account, and no owned backend, so the
attack surface is what runs in the browser:

- The content script, which is injected into every page and therefore handles
  fully untrusted DOM and text.
- The service worker, which owns every network call and every write to storage.
- The offscreen document, which owns audio playback.
- Message passing between them (`src/shared/messages.ts`), including the
  validation that rejects malformed or hostile payloads.
- Storage handling in `src/storage/`, including anything a page could influence
  on its way into IndexedDB.
- The declarative net request rule in `public/rules/edge-tts.json` — anything
  showing it affects requests beyond the Edge Read Aloud WebSocket handshake is
  a genuine finding.

## What is not in scope

- **Vulnerabilities in the Kokoro server.** It is a separate project
  ([Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)) that you host
  yourself; report those upstream. The extension's default configuration binds
  it to `127.0.0.1`, and exposing it to a network is your decision.
- **The Edge Read Aloud endpoint itself.** See the note below.
- Findings that require the user to have already installed a malicious
  extension, or to have granted a hostile page devtools access.

## A note on the Edge Read Aloud engine

The optional Edge engine speaks to `speech.platform.bing.com`, the undocumented
endpoint behind Microsoft Edge's *Read Aloud* feature. It takes no API key and
therefore carries no credential, but it is not a public API: Microsoft does not
support third-party use of it and may change or block it at any time. Every
sentence read through that engine is sent to Microsoft.

This is a documented, user-selectable trade-off rather than a vulnerability —
the README states it plainly, and the self-hosted Kokoro engine is the default
precisely so text stays on your machine. Reports that the endpoint may stop
working are not security issues.

## What the extension stores

Settings live in `chrome.storage.local`; vocabulary, occurrences, and cached
dictionary responses live in IndexedDB. All of it is local to the browser
profile. The extension stores no API keys, login tokens, or credentials, because
it has none.
