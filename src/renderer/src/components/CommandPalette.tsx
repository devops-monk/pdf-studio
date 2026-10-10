import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { commands, runCommand } from '@/commands'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'

/** Scores how well `q` matches `label`: prefix > word start > substring > subsequence. */
function score(label: string, q: string): number {
  const l = label.toLowerCase()
  if (!q) return 1
  if (l.startsWith(q)) return 100 - l.length * 0.1
  if (l.split(/[\s&/-]+/).some((w) => w.startsWith(q))) return 80 - l.length * 0.1
  if (l.includes(q)) return 60 - l.length * 0.1
  let i = 0
  for (const ch of l) if (ch === q[i]) i++
  return i === q.length ? 20 - l.length * 0.1 : -1
}

export function CommandPalette(): ReactNode {
  const open = useUi((s) => s.paletteOpen)
  const hasDoc = useDocs((s) => !!s.activeId)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    return commands
      .filter((c) => hasDoc || !c.needsDoc)
      .map((c) => ({ c, s: Math.max(score(c.label, query), score(`${c.group} ${c.label}`, query) - 5) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c)
  }, [q, hasDoc])

  if (!open) return null
  const close = (): void => {
    useUi.getState().set({ paletteOpen: false })
    setQ('')
    setSel(0)
  }
  const run = (id: string): void => {
    close()
    runCommand(id)
  }
  const move = (d: number): void => {
    const n = (sel + d + results.length) % Math.max(1, results.length)
    setSel(n)
    listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search tools and commands">
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search tools and commands"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), move(1))
              if (e.key === 'ArrowUp') (e.preventDefault(), move(-1))
              if (e.key === 'Enter' && results[sel]) run(results[sel].id)
              if (e.key === 'Escape') close()
            }}
          />
        </div>
        <ul className="palette-list" ref={listRef} role="listbox">
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel}>
              <button className={i === sel ? 'on' : ''} onMouseMove={() => setSel(i)} onClick={() => run(c.id)}>
                <span className="palette-label">{c.label}</span>
                <span className="palette-group">{c.group}</span>
                {c.keys && <kbd className="kbd">{c.keys}</kbd>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">No tools match “{q}”.</li>}
        </ul>
      </div>
    </div>
  )
}
