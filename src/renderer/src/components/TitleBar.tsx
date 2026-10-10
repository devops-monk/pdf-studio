import { useEffect, useRef, type ReactNode } from 'react'
import { FileText, Home, Moon, Plus, Search, Sun, X } from 'lucide-react'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'
import { MOD, openWithDialog } from '@/commands'

const isMac = window.api.platform === 'darwin'

export function TitleBar(): ReactNode {
  const docs = useDocs((s) => s.docs)
  const activeId = useDocs((s) => s.activeId)
  const home = useUi((s) => s.home)
  const fullscreen = useUi((s) => s.fullscreen)
  const theme = useUi((s) => s.theme)
  const stripRef = useRef<HTMLDivElement>(null)

  // Keep the active tab visible when switching or opening documents.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, docs.length])

  const dark = document.documentElement.dataset.theme === 'dark'

  return (
    <header className={`titlebar${isMac && !fullscreen ? ' mac' : ''}${!isMac ? ' overlay' : ''}`}>
      <button
        className={`tab home-tab${home || !activeId ? ' active' : ''}`}
        onClick={() => useUi.getState().set({ home: true })}
        aria-label="Home"
        title="Home"
      >
        <Home size={15} />
      </button>
      <div
        className="tabs"
        ref={stripRef}
        role="tablist"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) stripRef.current!.scrollLeft += e.deltaY
        }}
      >
        {docs.map((d) => (
          <div
            key={d.id}
            role="tab"
            aria-selected={!home && d.id === activeId}
            className={`tab${!home && d.id === activeId ? ' active' : ''}`}
            title={d.path ?? d.name}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                useDocs.getState().close(d.id)
              }
            }}
            onClick={() => {
              useDocs.getState().setActive(d.id)
              useUi.getState().set({ home: false })
            }}
          >
            <FileText size={14} className="tab-icon" />
            <span className="tab-name">{d.name}</span>
            <button
              className={`tab-close${d.dirty ? ' dirty' : ''}`}
              aria-label={`Close ${d.name}`}
              onClick={(e) => {
                e.stopPropagation()
                useDocs.getState().close(d.id)
              }}
            >
              <span className="dot" />
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="tab-add" onClick={openWithDialog} aria-label="Open a PDF" title={`Open (${MOD}O)`}>
          <Plus size={15} />
        </button>
      </div>
      <div className="titlebar-actions">
        <button className="search-pill" onClick={() => useUi.getState().set({ paletteOpen: true })}>
          <Search size={13} />
          <span>Search tools</span>
          <kbd className="kbd">{MOD}K</kbd>
        </button>
        <button
          className="icon-btn"
          aria-label={dark ? 'Use light theme' : 'Use dark theme'}
          title={`Theme: ${theme}`}
          onClick={() => useUi.getState().setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  )
}
