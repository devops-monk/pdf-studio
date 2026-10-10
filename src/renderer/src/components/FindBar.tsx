import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import type { Doc } from '@/store/docs'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'
import { findAll } from '@/core/search'

export function FindBar({ doc }: { doc: Doc }): ReactNode {
  const find = useUi((s) => s.find)
  const setFind = useUi((s) => s.setFind)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (find.open) inputRef.current?.select()
  }, [find.open])

  // Search as you type, debounced; stale searches are abandoned.
  useEffect(() => {
    if (!find.open) return
    let cancelled = false
    const t = setTimeout(async () => {
      if (!find.query.trim()) {
        setFind({ results: [], current: -1, searching: false })
        return
      }
      setFind({ searching: true })
      const results = await findAll(doc.pdf, find.query, find, () => cancelled)
      if (cancelled) return
      const here = results.findIndex((r) => r.page >= doc.view.page)
      setFind({ results, current: results.length ? Math.max(0, here) : -1, searching: false })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [find.query, find.matchCase, find.wholeWord, find.open, doc.pdf]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the current match's page into view.
  useEffect(() => {
    const r = find.results[find.current]
    if (r && r.page !== useDocs.getState().get(doc.id)?.view.page) useDocs.getState().goTo(doc.id, r.page)
  }, [find.current, find.results, doc.id])

  if (!find.open) return null
  const step = (d: number): void => {
    if (!find.results.length) return
    setFind({ current: (find.current + d + find.results.length) % find.results.length })
  }

  return (
    <div className="findbar" role="search">
      <input
        ref={inputRef}
        className="input"
        placeholder="Find in document"
        value={find.query}
        autoFocus
        onChange={(e) => setFind({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
          if (e.key === 'Escape') setFind({ open: false })
        }}
      />
      <span className="find-count" aria-live="polite">
        {find.searching ? (
          <Loader2 size={13} className="spin" />
        ) : find.query.trim() ? (
          find.results.length ? (
            `${find.current + 1} of ${find.results.length}`
          ) : (
            'No matches'
          )
        ) : null}
      </span>
      <button className="icon-btn sm" aria-label="Previous match" onClick={() => step(-1)} disabled={!find.results.length}>
        <ChevronUp size={15} />
      </button>
      <button className="icon-btn sm" aria-label="Next match" onClick={() => step(1)} disabled={!find.results.length}>
        <ChevronDown size={15} />
      </button>
      <label className="check small">
        <input type="checkbox" checked={find.matchCase} onChange={(e) => setFind({ matchCase: e.target.checked })} />
        Aa
      </label>
      <label className="check small" title="Whole words">
        <input type="checkbox" checked={find.wholeWord} onChange={(e) => setFind({ wholeWord: e.target.checked })} />
        Word
      </label>
      <button className="icon-btn sm" aria-label="Close find" onClick={() => setFind({ open: false })}>
        <X size={14} />
      </button>
    </div>
  )
}
