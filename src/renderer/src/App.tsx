import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileUp } from 'lucide-react'
import { TitleBar } from './components/TitleBar'
import { Toolbar, ToolStrip, removeSelected } from './components/Toolbar'
import { Rail, Sidebar } from './components/Sidebar'
import { Viewer } from './components/viewer/Viewer'
import { FindBar } from './components/FindBar'
import { Home } from './components/Home'
import { Organize } from './components/Organize'
import { CommandPalette } from './components/CommandPalette'
import { Dialogs } from './components/dialogs'
import { BusyOverlay, Toasts, toast } from './components/ui'
import { useDocs, openFiles, openPaths, viewDefaults, type Fit, type Layout } from './store/docs'
import { applyTheme, useUi, type Theme, type Tool } from './store/ui'
import { runCommand } from './commands'
import { imageToDataUrl } from './core/tools'

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement
  return !!t.closest('input, textarea, select, [contenteditable="true"]')
}

/** Shortcuts that native menus don't cover (single keys, page keys, Space-to-pan). */
function useKeys(): void {
  const spaceTool = useRef<Tool | null>(null)
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const ui = useUi.getState()
      if (ui.dialog || ui.paletteOpen) return
      const doc = useDocs.getState().active()
      const mod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        if (ui.find.open) return ui.setFind({ open: false })
        if (ui.selectedAnnot) return ui.set({ selectedAnnot: null })
        if (ui.readMode) return ui.set({ readMode: false })
        if (ui.tool !== 'select') return ui.setTool('select')
        if (ui.toolGroup) return ui.set({ toolGroup: null })
      }
      if (isTyping(e) || !doc || ui.home) return

      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        return runCommand('view.zoomIn')
      }
      if (mod) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedAnnot && ui.mode === 'view') {
        e.preventDefault()
        return removeSelected(doc)
      }
      if (ui.mode !== 'view') return
      switch (e.key) {
        case 'v':
        case 'V':
          return ui.setTool('select')
        case 'h':
        case 'H':
          return ui.setTool('hand')
        case 'PageDown':
          if (doc.view.layout === 'single') return (e.preventDefault(), runCommand('view.nextPage'))
          return
        case 'PageUp':
          if (doc.view.layout === 'single') return (e.preventDefault(), runCommand('view.prevPage'))
          return
        case 'ArrowRight':
        case 'ArrowDown':
          if (doc.view.layout === 'single') return (e.preventDefault(), runCommand('view.nextPage'))
          return
        case 'ArrowLeft':
        case 'ArrowUp':
          if (doc.view.layout === 'single') return (e.preventDefault(), runCommand('view.prevPage'))
          return
        case 'Home':
          e.preventDefault()
          return runCommand('view.firstPage')
        case 'End':
          e.preventDefault()
          return runCommand('view.lastPage')
        case ' ':
          if (!spaceTool.current && ui.tool !== 'hand') {
            e.preventDefault()
            spaceTool.current = ui.tool
            ui.set({ tool: 'hand' })
          } else if (spaceTool.current) e.preventDefault()
          return
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === ' ' && spaceTool.current) {
        useUi.getState().set({ tool: spaceTool.current })
        spaceTool.current = null
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
}

/** Accepts PDFs (open) and images (place on the page, or make a PDF) dropped anywhere. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e) || useUi.getState().dialog) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e) && !useUi.getState().dialog) e.preventDefault()
    }
    const drop = async (e: DragEvent): Promise<void> => {
      depth = 0
      setOver(false)
      if (!hasFiles(e) || useUi.getState().dialog) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer!.files)
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (pdfs.length) {
        await openFiles(
          await Promise.all(pdfs.map(async (f) => ({ name: f.name, path: window.api.pathForFile(f) || null, data: new Uint8Array(await f.arrayBuffer()) })))
        )
        useUi.getState().set({ home: false })
      }
      if (images.length && !pdfs.length) {
        if (useDocs.getState().active() && !useUi.getState().home) {
          const img = await imageToDataUrl(new Uint8Array(await images[0].arrayBuffer()))
          useUi.getState().setStyle({ pendingImage: { ...img, signature: false } })
          useUi.getState().set({ toolGroup: 'comment', mode: 'view' })
          useUi.getState().setTool('image')
          toast.info('Click on the page to place the image.')
        } else {
          useUi.getState().openDialog('imagesToPdf')
        }
      }
      if (!pdfs.length && !images.length) toast.error('Only PDF files and images can be opened.')
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

export function App(): ReactNode {
  const doc = useDocs((s) => s.active())
  const docCount = useDocs((s) => s.docs.length)
  const home = useUi((s) => s.home)
  const mode = useUi((s) => s.mode)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const readMode = useUi((s) => s.readMode)
  const dropping = useFileDrop()
  useKeys()

  useEffect(() => {
    ;(async () => {
      const prefs = await window.api.prefs.get()
      const theme = (prefs.theme as Theme) ?? 'system'
      useUi.setState({ theme, sidebarOpen: prefs.restoreSidebar !== false })
      applyTheme(theme)
      window.api.setTheme(theme)
      if (prefs.defaultFit) viewDefaults.fit = prefs.defaultFit === 'actual' ? null : (prefs.defaultFit as Fit)
      if (prefs.defaultLayout) viewDefaults.layout = prefs.defaultLayout as Layout
      window.api.ready()
    })()
    const offPaths = window.api.onOpenPaths(async (paths) => {
      await openPaths(paths)
      useUi.getState().set({ home: false })
    })
    const offMenu = window.api.onMenuCommand((id) => {
      // Native Undo/Redo should still edit text fields.
      const typing = (document.activeElement as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')
      if (typing && (id === 'edit.undo' || id === 'edit.redo')) return void document.execCommand(id === 'edit.undo' ? 'undo' : 'redo')
      runCommand(id)
    })
    const offFs = window.api.onFullscreen((on) => useUi.getState().set({ fullscreen: on }))
    return () => {
      offPaths()
      offMenu()
      offFs()
    }
  }, [])

  // Leave document-only modes when the last document closes.
  useEffect(() => {
    if (docCount === 0) useUi.getState().set({ home: true, mode: 'view', toolGroup: null, readMode: false })
  }, [docCount])

  const showDoc = doc && !home

  return (
    <div className={`app${readMode && showDoc ? ' reading' : ''}`}>
      <TitleBar />
      {showDoc ? (
        <>
          {!readMode && <Toolbar doc={doc} />}
          {!readMode && mode === 'view' && <ToolStrip doc={doc} />}
          <div className="workspace">
            {!readMode && mode === 'view' && <Rail />}
            {!readMode && mode === 'view' && sidebarOpen && <Sidebar doc={doc} />}
            <main className="stage">
              {mode === 'view' && <FindBar doc={doc} />}
              {mode === 'organize' ? <Organize key={doc.id} doc={doc} /> : <Viewer key={doc.id} doc={doc} />}
              {readMode && (
                <button className="read-exit" onClick={() => useUi.getState().set({ readMode: false })}>
                  Exit read mode <kbd className="kbd">Esc</kbd>
                </button>
              )}
            </main>
          </div>
        </>
      ) : (
        <Home />
      )}
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-card">
            <FileUp size={28} />
            <strong>Drop to open</strong>
            <span>PDFs open in new tabs. Images go onto the current page.</span>
          </div>
        </div>
      )}
      <CommandPalette />
      <Dialogs />
      <BusyOverlay />
      <Toasts />
    </div>
  )
}
