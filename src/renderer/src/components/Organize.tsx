import { useEffect, useState, type ReactNode } from 'react'
import { Copy, FileDown, FilePlus2, FileUp, RotateCcw, RotateCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import type { Doc } from '@/store/docs'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'
import { useThumbnail, usePageRatios } from '@/core/thumbs'
import { deletePages, duplicatePages, insertBlankPages, movePagesOrder, reorderPages, rotatePages } from '@/core/ops'
import { withBusy, toast } from './ui'

function Card(props: {
  doc: Doc
  index: number
  ratio: number
  width: number
  selected: boolean
  dropBefore: boolean
  dropAfter: boolean
  label: string | null
  onSelect: (e: React.MouseEvent) => void
  onOpen: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}): ReactNode {
  const [ref, url] = useThumbnail(props.doc.pdf, props.index, props.width)
  return (
    <div
      className={`org-card${props.selected ? ' selected' : ''}${props.dropBefore ? ' drop-before' : ''}${props.dropAfter ? ' drop-after' : ''}`}
      style={{ width: props.width }}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onClick={props.onSelect}
      onDoubleClick={props.onOpen}
      role="option"
      aria-selected={props.selected}
      aria-label={`Page ${props.index + 1}`}
    >
      <div ref={ref} className="org-img" style={{ aspectRatio: `1 / ${props.ratio || 1.294}` }}>
        {url && <img src={url} alt="" draggable={false} />}
      </div>
      <span className="org-num">{props.label && props.label !== String(props.index + 1) ? `${props.label} · ${props.index + 1}` : props.index + 1}</span>
    </div>
  )
}

export function Organize({ doc }: { doc: Doc }): ReactNode {
  const selected = useUi((s) => s.selectedPages)
  const set = useUi((s) => s.set)
  const ratios = usePageRatios(doc.pdf)
  const [size, setSize] = useState(170)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null)
  const [labels, setLabels] = useState<string[] | null>(null)

  useEffect(() => {
    doc.pdf.getPageLabels().then(setLabels, () => setLabels(null))
  }, [doc.pdf])

  // Drop selections that point past the end after deletions.
  useEffect(() => {
    if (selected.some((i) => i >= doc.numPages)) set({ selectedPages: selected.filter((i) => i < doc.numPages) })
  }, [doc.numPages]) // eslint-disable-line react-hooks/exhaustive-deps

  const sel = [...selected].sort((a, b) => a - b)
  const targets = sel.length ? sel : []
  const apply = (label: string, op: (b: Uint8Array) => Promise<Uint8Array>, after?: number[]): void => {
    withBusy(`${label}…`, async () => {
      const ok = await useDocs.getState().apply(doc.id, label, op)
      if (ok && after) set({ selectedPages: after })
    })
  }

  const select = (i: number, e: React.MouseEvent): void => {
    if (e.shiftKey && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]
      const range = Array.from({ length: b - a + 1 }, (_, k) => a + k)
      set({ selectedPages: e.metaKey || e.ctrlKey ? [...new Set([...selected, ...range])] : range })
    } else if (e.metaKey || e.ctrlKey) {
      set({ selectedPages: selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i] })
      setAnchor(i)
    } else {
      set({ selectedPages: [i] })
      setAnchor(i)
    }
  }

  const rotate = (delta: number): void => apply(delta > 0 ? 'Rotate pages' : 'Rotate pages left', (b) => rotatePages(b, targets, delta), sel)
  const remove = (): void => {
    if (targets.length >= doc.numPages) {
      toast.error('A document needs at least one page. Keep at least one page unselected.')
      return
    }
    apply(targets.length === 1 ? 'Delete page' : 'Delete pages', (b) => deletePages(b, targets), [])
  }
  const duplicate = (): void => apply('Duplicate pages', (b) => duplicatePages(b, targets))
  const insertBlank = (): void => {
    const at = sel.length ? sel.at(-1)! + 1 : doc.numPages
    apply('Insert blank page', (b) => insertBlankPages(b, at), [at])
  }

  const move = (moving: number[], target: number): void => {
    const order = movePagesOrder(doc.numPages, moving, target)
    if (order.every((v, i) => v === i)) return
    const newPositions = order.map((old, pos) => (moving.includes(old) ? pos : -1)).filter((p) => p >= 0)
    apply(moving.length === 1 ? 'Move page' : 'Move pages', (b) => reorderPages(b, order), newPositions)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && targets.length) {
        e.preventDefault()
        remove()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        set({ selectedPages: Array.from({ length: doc.numPages }, (_, i) => i) })
      }
      if (e.key === 'Escape') set({ selectedPages: [] })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const none = targets.length === 0

  return (
    <div className="organize">
      <div className="org-bar" role="toolbar" aria-label="Page tools">
        <span className="org-count">{none ? `${doc.numPages} pages` : `${targets.length} of ${doc.numPages} selected`}</span>
        <span className="tb-sep" />
        <button className="icon-btn" title="Rotate left" aria-label="Rotate left" disabled={none} onClick={() => rotate(-90)}>
          <RotateCcw size={16} />
        </button>
        <button className="icon-btn" title="Rotate right" aria-label="Rotate right" disabled={none} onClick={() => rotate(90)}>
          <RotateCw size={16} />
        </button>
        <button className="icon-btn" title="Duplicate" aria-label="Duplicate" disabled={none} onClick={duplicate}>
          <Copy size={16} />
        </button>
        <button className="icon-btn" title="Delete" aria-label="Delete" disabled={none} onClick={remove}>
          <Trash2 size={16} />
        </button>
        <span className="tb-sep" />
        <button className="btn sm ghost" onClick={insertBlank}>
          <FilePlus2 size={14} /> Blank page
        </button>
        <button className="btn sm ghost" onClick={() => useUi.getState().openDialog('insert', { at: sel.length ? sel.at(-1)! + 1 : doc.numPages })}>
          <FileUp size={14} /> Insert from file
        </button>
        <button className="btn sm ghost" disabled={none} onClick={() => useUi.getState().openDialog('extract', { pages: targets })}>
          <FileDown size={14} /> Extract
        </button>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => set({ selectedPages: none ? Array.from({ length: doc.numPages }, (_, i) => i) : [] })}>
          {none ? 'Select all' : 'Select none'}
        </button>
        <ZoomOut size={14} className="faint" />
        <input type="range" min={100} max={320} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Thumbnail size" style={{ width: 110 }} />
        <ZoomIn size={14} className="faint" />
      </div>
      <div
        className="org-grid"
        role="listbox"
        aria-multiselectable
        onClick={(e) => e.target === e.currentTarget && set({ selectedPages: [] })}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDrop(null)
        }}
      >
        {Array.from({ length: doc.numPages }, (_, i) => (
          <Card
            key={`${doc.version}-${i}`}
            doc={doc}
            index={i}
            ratio={ratios[i]}
            width={size}
            label={labels?.[i] ?? null}
            selected={selected.includes(i)}
            dropBefore={drop?.index === i && !drop.after}
            dropAfter={drop?.index === i && drop.after}
            onSelect={(e) => select(i, e)}
            onOpen={() => {
              set({ mode: 'view' })
              useDocs.getState().goTo(doc.id, i)
            }}
            onDragStart={(e) => {
              const moving = selected.includes(i) ? sel : [i]
              if (!selected.includes(i)) set({ selectedPages: [i] })
              e.dataTransfer.setData('application/x-pdfstudio-pages', JSON.stringify(moving))
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-pdfstudio-pages')) return
              e.preventDefault()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const after = e.clientX > r.left + r.width / 2
              if (drop?.index !== i || drop.after !== after) setDrop({ index: i, after })
            }}
            onDrop={(e) => {
              e.preventDefault()
              const raw = e.dataTransfer.getData('application/x-pdfstudio-pages')
              const d = drop
              setDrop(null)
              if (!raw || !d) return
              move(JSON.parse(raw) as number[], d.index + (d.after ? 1 : 0))
            }}
          />
        ))}
      </div>
    </div>
  )
}
