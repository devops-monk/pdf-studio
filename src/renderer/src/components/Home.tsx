import { useEffect, useState, type ReactNode } from 'react'
import { Clock, FileText, FolderOpen, Trash2, X } from 'lucide-react'
import { MOD, openWithDialog, runCommand, toolCatalog, type ToolCard } from '@/commands'
import { openPaths } from '@/store/docs'
import { useUi } from '@/store/ui'
import type { RecentFile } from '../../../preload'

function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(t).toLocaleDateString()
}

const SECTIONS: ToolCard['section'][] = ['Organize', 'Review', 'Protect', 'Convert', 'Optimize']

export function Home(): ReactNode {
  const [recent, setRecent] = useState<RecentFile[]>([])
  const refresh = (): void => void window.api.recent.list().then(setRecent)
  useEffect(refresh, [])

  const open = async (paths: string[]): Promise<void> => {
    await openPaths(paths)
    useUi.getState().set({ home: false })
    refresh()
  }

  return (
    <div className="home">
      <section className="home-hero">
        <h1 className="wordmark">
          <span className="marker">PDF</span> Studio
        </h1>
        <p className="home-lede">Read, mark up, organize and protect PDFs. Everything stays on this computer.</p>
        <div className="home-actions">
          <button className="btn primary lg" onClick={openWithDialog}>
            <FolderOpen size={16} /> Open a PDF
          </button>
          <button className="btn lg" onClick={() => runCommand('tool.combine')}>
            Combine files
          </button>
          <button className="btn lg ghost" onClick={() => runCommand('tool.imagesToPdf')}>
            Images to PDF
          </button>
        </div>
        <div className="drop-hint">
          or drop files anywhere in this window · <kbd className="kbd">{MOD}O</kbd> to open · <kbd className="kbd">{MOD}K</kbd> for every tool
        </div>
      </section>

      <div className="home-grid">
        <section className="home-recent">
          <header className="home-head">
            <h2>Recent</h2>
            {recent.length > 0 && (
              <button className="btn sm ghost" onClick={() => window.api.recent.clear().then(refresh)}>
                <Trash2 size={13} /> Clear
              </button>
            )}
          </header>
          {recent.length === 0 ? (
            <div className="recent-empty">
              <Clock size={18} />
              <span>Files you open show up here.</span>
            </div>
          ) : (
            <ul className="recent-list">
              {recent.map((r) => (
                <li key={r.path}>
                  <button className="recent-item" onClick={() => open([r.path])} title={r.path}>
                    <FileText size={18} className="recent-icon" />
                    <span className="recent-text">
                      <span className="recent-name ellipsis">{r.name}</span>
                      <span className="recent-path ellipsis">{r.path.replace(/[\\/][^\\/]+$/, '')}</span>
                    </span>
                    <span className="recent-time">{timeAgo(r.openedAt)}</span>
                  </button>
                  <button
                    className="icon-btn sm recent-remove"
                    aria-label={`Remove ${r.name} from recent`}
                    onClick={() => window.api.recent.remove(r.path).then(refresh)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-tools">
          <header className="home-head">
            <h2>Tools</h2>
          </header>
          {SECTIONS.map((s) => (
            <div key={s} className="tool-section">
              <h3>{s}</h3>
              <div className="tool-cards">
                {toolCatalog
                  .filter((t) => t.section === s)
                  .map((t) => (
                    <button key={t.command} className="tool-card" onClick={() => runCommand(t.command)}>
                      <t.icon size={18} strokeWidth={1.75} className="tool-card-icon" />
                      <span className="tool-card-title">{t.title}</span>
                      <span className="tool-card-desc">{t.desc}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
