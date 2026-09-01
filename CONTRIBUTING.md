# Contributing

Thanks for taking an interest. This is a small, self-contained Chrome extension
with no backend, so getting from a clone to a running build is short.

## Getting set up

You need Node.js 18.18 or newer and Yarn 4. Yarn's version is pinned in
`package.json`, so `corepack enable` is the whole install.

```sh
yarn install
yarn build        # unpacked extension in output/
```

Load `output/` through `chrome://extensions` with Developer mode on. The README
has the full walkthrough, including how to run the local Kokoro speech server.

`yarn dev` builds in development mode and keeps watching. Chrome does not pick
changes up on its own — press the reload arrow on the extension card.

## Before you open a pull request

All three must pass. CI runs exactly these, so a green local run is a green CI
run.

```sh
yarn lint         # ESLint, zero warnings tolerated
yarn typecheck    # tsc --noEmit
yarn test         # Vitest
```

New behavior needs tests. The suite is fast — under two seconds — so there is no
reason to skip it while working. `yarn test:watch` reruns on change.

## House rules

**Everything in this repository is written in English**: code, identifiers,
comments, UI strings, error messages, test names, commit messages, and
documentation. Non-English text is allowed only as *data* — voice preview
strings, dictionary fixtures, sentence-splitting test inputs. `AGENTS.md` states
this in full.

**Storage stays behind repository interfaces.** Nothing outside `src/storage/`
talks to IndexedDB or `chrome.storage` directly.

**Network calls belong to the service worker.** The content script sends text, a
voice, and a rate; it never learns which speech engine is selected and never
opens a socket itself. `docs/ARCHITECTURE.md` draws the boundaries.

**No new remote dependencies without discussion.** The extension has no account,
no telemetry, and no owned backend, and it should stay that way. Adding a
third-party endpoint means adding a `host_permissions` entry, which is a
user-visible permission prompt — open an issue first.

Prefer many small files over few large ones, and keep functions small. If a file
is heading past 800 lines, something wants extracting.

## Commit messages

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`,
`perf:`, `ci:`, followed by a short description in the imperative.

## Reporting bugs

Say which speech engine you were using — Kokoro or Edge — and which browser and
version. Reading and highlighting behave differently between the two engines,
and a bug in one is usually not present in the other.
