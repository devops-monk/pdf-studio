import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-serif/500.css'
import '@fontsource/ibm-plex-serif/600-italic.css'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import { App } from './App'
import { applyTheme } from './store/ui'

applyTheme('system')
createRoot(document.getElementById('root')!).render(<App />)

// Handle for automated UI checks (used by the development test driver).
import { useDocs, openPaths } from './store/docs'
import { useUi } from './store/ui'
import { runCommand } from './commands'
import * as ops from './core/ops'
import * as pdf from './core/pdf'
import * as tools from './core/tools'
import * as search from './core/search'
;(window as unknown as Record<string, unknown>).__studio = { useDocs, useUi, runCommand, openPaths, ops, pdf, tools, search }
