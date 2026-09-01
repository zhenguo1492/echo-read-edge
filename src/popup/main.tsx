import { render } from 'preact'

import { App } from './App'

// The dictionary entry is the content script's panel, so the popup loads the
// same stylesheet that document injects into its shadow root.
import '@/shared/styles/panel.css'
import './styles/popup.css'

const root = document.getElementById('app')
if (!root) throw new Error('The EchoRead Edge popup root element was not found.')

// Preact is retained from the legacy extension to keep later UI ports focused.
render(<App />, root)

