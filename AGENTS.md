# AGENTS.md

This file defines mandatory instructions for all work in this repository.

## Language requirement

All project content MUST be written in English.

This requirement includes, but is not limited to:

- Source code
- Variable, function, class, type, interface, and file names
- Inline comments and block comments
- JSDoc and TSDoc
- User interface text
- Error messages and log messages
- Tests, fixtures, and test descriptions
- Configuration comments
- Documentation and diagrams
- Issue and pull request text created for this project
- Commit messages

Do not add Chinese or any other non-English prose to project files. User-provided
content and dictionary data processed at runtime are not subject to this rule.

Documents under `docs/private/` are exempt from this language requirement and
may be written in Chinese. This exception does not apply to source code,
configuration, tests, public documentation, or any files outside that directory.

## Product constraints

- The product is a standalone Chrome Manifest V3 extension.
- Do not introduce an EchoRead-owned backend or require user login.
- Speech comes from a self-hosted Kokoro server by default, with direct
  Microsoft Edge Read Aloud synthesis as the optional fallback engine.
- Store user settings locally in `chrome.storage.local`.
- Store vocabulary and structured user data in IndexedDB.
- Keep storage behind repository interfaces; nothing outside `src/storage/`
  touches IndexedDB or `chrome.storage` directly.
- Keep every network call in the service worker. The content script sends text,
  a voice, and a rate, and never learns which speech engine is selected.
- Adding a third-party endpoint means adding a `host_permissions` entry, which
  is a user-visible permission prompt. Do not add one without an explicit scope
  decision.
- Keep the vocabulary feature limited to list management; do not add flashcard
  review, mastery scoring, or spaced-repetition scheduling.
- Do not add grammar analysis, pronunciation shadowing, or recording unless the
  product scope is explicitly changed.
- Preserve existing user interactions and behavior unless a documented scope
  decision changes them.

## Working in this repository

This project began as a migration from an earlier, backend-backed version of
EchoRead. That predecessor is not public and is not available to contributors;
the boundaries it left behind are documented in `docs/ARCHITECTURE.md`, which is
the reference to work from.

Before implementing a feature:

1. Read `docs/ARCHITECTURE.md` for the runtime boundaries it crosses, and
   `docs/TTS_DATA_FLOW.md` if it touches reading, chunking, or playback.
2. Look for an existing module that already owns the concern. Prefer extending
   it over adding a parallel implementation.
3. Write the test first, and keep it fast — the suite runs in under two seconds
   and should stay that way.
4. Put new behavior behind the existing seams: a Provider for anything remote, a
   Repository for anything stored.
5. Record intentional behavior changes in `CHANGELOG.md` under `[Unreleased]`.

`yarn lint`, `yarn typecheck`, and `yarn test` must all pass before work is
considered done. CI runs exactly those three plus a build.
