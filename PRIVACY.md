# Privacy Policy for EchoRead Edge

**Last updated: 2026-09-01**

EchoRead Edge is a browser extension that reads web pages aloud and keeps a
local vocabulary list. It has no account, no login, and no server operated by
its developers. This policy describes exactly what the extension does with your
data.

## Summary

- The developers of EchoRead Edge **operate no server and receive no data from
  you** — none at all.
- The extension contains **no analytics, telemetry, tracking, or advertising**
  code.
- Everything the extension stores stays **on your own device**.
- Nothing is ever **sold or transferred** to third parties.

## What the extension stores on your device

All of the following is stored locally, through the browser's own extension
storage and IndexedDB. It never leaves your machine unless you export or sync
it yourself through your browser.

| Data | Purpose |
|---|---|
| Preferences — reading speed, chosen speech engine, chosen voice per language, translation target language, UI settings | To restore your setup the next time you open the extension |
| Your vocabulary list — words you explicitly save, their definitions, and the sentence and page title they came from | To let you review and search words you saved |
| A short-lived cache of dictionary and translation responses | To avoid repeating the same lookup |

You can delete any of this at any time: remove individual words from the
vocabulary list inside the extension, or uninstall the extension to remove all
of it.

## What the extension sends off your device, and to whom

The extension only makes a network request in direct response to something you
do — starting playback, looking up a word, or requesting a translation. It
sends the text needed for that action and nothing else. It never sends your
browsing history, your identity, or the contents of pages you did not ask it to
read.

| Destination | What is sent | When |
|---|---|---|
| Your own Kokoro server on `localhost` / `127.0.0.1` (default speech engine, self-hosted by you) | The sentence to be spoken | While reading a page aloud |
| `speech.platform.bing.com` (Microsoft Edge Read Aloud — the optional zero-setup speech engine) | The sentence to be spoken | While reading a page aloud, only if you select this engine |
| `dict.youdao.com`, `api.dictionaryapi.dev`, `en.wiktionary.org` (dictionary sources) | The single word you looked up | When you look up a word |
| `translate.googleapis.com` (translation) | The sentence or selection to be translated | When you request a translation |

These are third-party services with their own privacy policies, and the
developers of EchoRead Edge have no relationship with, and no visibility into,
what they do with a request. If you would rather no text leave your machine at
all, use the default self-hosted Kokoro engine and do not use the dictionary or
translation features.

## Why the extension asks for its permissions

- **`activeTab`** — to read the text of the page you are currently on, so it
  can be spoken aloud and the spoken word highlighted. The page content is used
  in the tab and is not collected.
- **`storage`** — to save your preferences and vocabulary list on your device.
- **`offscreen`** — to play audio from a background document, so playback
  survives normal page activity.
- **`declarativeNetRequestWithHostAccess`** — to set the request headers that
  the Microsoft Edge Read Aloud endpoint requires. It is not used to observe,
  block, or modify your browsing.
- **Host permissions** — limited to the speech, dictionary, and translation
  endpoints listed in the table above, plus your own local Kokoro server.

## Data sale and transfer

The developers do not sell, rent, trade, or transfer any user data, and do not
use it for any purpose unrelated to the extension's single stated function.
Since no data reaches the developers in the first place, there is nothing to
sell or transfer.

## Children

The extension is not directed at children and collects nothing that could
identify anyone, of any age.

## Changes to this policy

Any change will be published in this file, with the date at the top updated.
The revision history is public in the repository.

## Contact

Questions or concerns: open an issue at
<https://github.com/zhenguo1492/echo-read-edge/issues>.
