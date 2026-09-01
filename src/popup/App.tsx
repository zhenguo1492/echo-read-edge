import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import { SettingsPanel } from './SettingsPanel'
import { WordDictionaryPanel } from './WordDictionaryPanel'
import { WordListPanel } from './WordListPanel'

type PopupTab = 'settings' | 'words'

const TABS: Array<{ id: PopupTab; label: string; description: string }> = [
  { id: 'settings', label: 'Settings', description: 'Reading settings' },
  { id: 'words', label: 'Words', description: 'Saved vocabulary list' }
]

/** Popup shell holding the reading settings and the local vocabulary list. */
export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<PopupTab>('settings')
  const [dictionaryWord, setDictionaryWord] = useState<string | null>(null)
  const activeDescription = TABS.find((tab) => tab.id === activeTab)?.description ?? ''

  // The popup window is sized by the document, so the dictionary column can only
  // appear beside the list once the body itself is wide enough to hold both.
  useEffect(() => {
    document.body.classList.toggle('has-dictionary', dictionaryWord !== null)
    return () => document.body.classList.remove('has-dictionary')
  }, [dictionaryWord])

  return (
    <div class="popup-layout">
      {/* The entry opens to the left of the shell, so the tabs and the list stay
          where the reader already clicked. */}
      {dictionaryWord !== null && (
        <aside class="popup-dictionary">
          <WordDictionaryPanel
            word={dictionaryWord}
            onClose={() => setDictionaryWord(null)}
          />
        </aside>
      )}

      <main class="popup-shell">
        <header class="popup-header">
          <img src="../icons/icon32.png" alt="" width="32" height="32" />
          <div>
            <h1>EchoRead Edge</h1>
            <p>{activeDescription}</p>
          </div>
        </header>

        <nav class="popup-tabs" aria-label="Popup sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              class={tab.id === activeTab ? 'is-active' : ''}
              aria-pressed={tab.id === activeTab}
              onClick={() => {
                setActiveTab(tab.id)
                // The entry belongs to the word list, so it leaves with it.
                if (tab.id !== 'words') setDictionaryWord(null)
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'settings' ? (
          <SettingsPanel />
        ) : (
          <WordListPanel openWord={dictionaryWord} onOpenWord={setDictionaryWord} />
        )}
      </main>

    </div>
  )
}
