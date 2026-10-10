import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bookmark,
  ChevronRight,
  Download,
  FileText,
  FormInput,
  Layers,
  LayoutPanelLeft,
  MessageSquare,
  Paperclip,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { Doc } from '@/store/docs'
import { useDocs } from '@/store/docs'
import { useUi, type Panel } from '@/store/ui'
import { destToPageIndex } from '@/core/pdf'
import { useThumbnail, usePageRatios } from '@/core/thumbs'
import { deleteNativeAnnotation } from '@/core/ops'
import { ocStates } from './viewer/Viewer'
import { Empty, toast } from './ui'

const PANELS: { id: Panel; label: string; icon: typeof Bookmark }[] = [
  { id: 'thumbs', label: 'Pages', icon: LayoutPanelLeft },
  { id: 'outline', label: 'Bookmarks', icon: Bookmark },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'fields', label: 'Form fields', icon: FormInput },
  { id: 'attachments', label: 'Attachments', icon: Paperclip },
  { id: 'layers', label: 'Layers', icon: Layers }
]

export function Rail(): ReactNode {
  const panel = useUi((s) => s.panel)
  const open = useUi((s) => s.sidebarOpen)
  const set = useUi((s) => s.set)
  return (
    <nav className="rail" aria-label="Panels">
      {PANELS.map((p) => (
        <button
          key={p.id}
          className={`icon-btn${open && panel === p.id ? ' active' : ''}`}
          title={p.label}
          aria-label={p.label}
          aria-pressed={open && panel === p.id}
          onClick={() => set(open && panel === p.id ? { sidebarOpen: false } : { sidebarOpen: true, panel: p.id })}
        >
          <p.icon size={18} strokeWidth={1.75} />
        </button>
      ))}
    </nav>
  )
}

export function Sidebar({ doc }: { doc: Doc }): ReactNode {
  const panel = useUi((s) => s.panel)
  const set = useUi((s) => s.set)
  const title = PANELS.find((p) => p.id === panel)!.label
  return (
    <aside className="sidebar">
      <header className="panel-head">
        <h3>{title}</h3>
        <button className="icon-btn sm" aria-label="Close panel" onClick={() => set({ sidebarOpen: false })}>
          <X size={14} />
        </button>
      </header>
      <div className="panel-body">
        {panel === 'thumbs' && <Thumbnails doc={doc} />}
        {panel === 'outline' && <Outline doc={doc} />}
        {panel === 'comments' && <Comments doc={doc} />}
        {panel === 'fields' && <Fields doc={doc} />}
        {panel === 'attachments' && <Attachments doc={doc} />}
        {panel === 'layers' && <LayersPanel doc={doc} />}
      </div>
    </aside>
  )
}

/* ---------------- Thumbnails ---------------- */

function Thumb({ doc, index, ratio, current }: { doc: Doc; index: number; ratio: number; current: boolean }): ReactNode {
  const [ref, url] = useThumbnail(doc.pdf, index, 150)
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    doc.pdf.getPageLabels().then((labels) => setLabel(labels?.[index] ?? null), () => undefined)
  }, [doc.pdf, index])
  useEffect(() => {
    if (current) (ref.current?.parentElement as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
  }, [current, ref])
  return (
    <button className={`thumb${current ? ' current' : ''}`} onClick={() => useDocs.getState().goTo(doc.id, index)} aria-label={`Page ${index + 1}`}>
      <div ref={ref} className="thumb-img" style={{ aspectRatio: `1 / ${ratio || 1.294}` }}>
        {url && <img src={url} alt="" draggable={false} />}
      </div>
      <span className="thumb-label">{label && label !== String(index + 1) ? `${label} (${index + 1})` : index + 1}</span>
    </button>
  )
}

function Thumbnails({ doc }: { doc: Doc }): ReactNode {
  const ratios = usePageRatios(doc.pdf)
  return (
    <div className="thumbs">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <Thumb key={`${doc.version}-${i}`} doc={doc} index={i} ratio={ratios[i]} current={doc.view.page === i} />
      ))}
    </div>
  )
}

/* ---------------- Outline ---------------- */

interface OutlineNode {
  title: string
  dest: unknown
  url: string | null
  items: OutlineNode[]
  bold?: boolean
  italic?: boolean
}

function filterTree(nodes: OutlineNode[], q: string): OutlineNode[] {
  if (!q) return nodes
  const out: OutlineNode[] = []
  for (const n of nodes) {
    const kids = filterTree(n.items, q)
    if (n.title.toLowerCase().includes(q) || kids.length) out.push({ ...n, items: kids })
  }
  return out
}

function OutlineItem({ node, doc, depth, forceOpen }: { node: OutlineNode; doc: Doc; depth: number; forceOpen: boolean }): ReactNode {
  const [open, setOpen] = useState<boolean>(false)
  const expanded = forceOpen || open
  const go = async (): Promise<void> => {
    if (node.url) return void window.api.openExternal(node.url)
    const i = await destToPageIndex(doc.pdf, node.dest)
    if (i != null) useDocs.getState().goTo(doc.id, i)
  }
  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: 6 + depth * 14 }}>
        {node.items.length ? (
          <button className={`tree-twisty${expanded ? ' open' : ''}`} aria-label={expanded ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
            <ChevronRight size={13} />
          </button>
        ) : (
          <span className="tree-twisty" />
        )}
        <button className="tree-label" onClick={go} style={{ fontWeight: node.bold ? 600 : undefined, fontStyle: node.italic ? 'italic' : undefined }}>
          {node.title || 'Untitled'}
        </button>
      </div>
      {expanded && node.items.length > 0 && (
        <ul>
          {node.items.map((n, i) => (
            <OutlineItem key={i} node={n} doc={doc} depth={depth + 1} forceOpen={forceOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Outline({ doc }: { doc: Doc }): ReactNode {
  const [tree, setTree] = useState<OutlineNode[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    doc.pdf.getOutline().then((o) => setTree((o as OutlineNode[] | null) ?? []), () => setTree([]))
  }, [doc.pdf])
  const shown = useMemo(() => filterTree(tree ?? [], q.trim().toLowerCase()), [tree, q])
  if (!tree) return null
  if (tree.length === 0)
    return (
      <Empty icon={<Bookmark size={22} />} title="No bookmarks">
        This document has no outline. Combined files get one bookmark per file.
      </Empty>
    )
  return (
    <>
      <div className="panel-search">
        <Search size={13} />
        <input className="input" placeholder="Filter bookmarks" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="icon-btn sm" aria-label="Clear" onClick={() => setQ('')}>
            <X size={12} />
          </button>
        )}
      </div>
      <ul className="tree">
        {shown.map((n, i) => (
          <OutlineItem key={i} node={n} doc={doc} depth={0} forceOpen={!!q} />
        ))}
      </ul>
      {q && shown.length === 0 && <p className="panel-note">No bookmarks match “{q}”.</p>}
    </>
  )
}

/* ---------------- Comments ---------------- */

interface NativeComment {
  id: string
  page: number
  subtype: string
  contents: string
  author: string
  date: string | null
}

const KIND_LABEL: Record<string, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strike-through',
  note: 'Note',
  text: 'Text box',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  ink: 'Drawing',
  stamp: 'Stamp',
  image: 'Image',
  redact: 'Redaction mark'
}

function Comments({ doc }: { doc: Doc }): ReactNode {
  const [native, setNative] = useState<NativeComment[] | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const out: NativeComment[] = []
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.pdf.getPage(i + 1)
        for (const a of await page.getAnnotations()) {
          if (['Link', 'Widget', 'Popup'].includes(a.subtype)) continue
          out.push({
            id: a.id,
            page: i,
            subtype: a.subtype,
            contents: a.contentsObj?.str ?? '',
            author: a.titleObj?.str ?? '',
            date: a.modificationDate ?? null
          })
        }
      }
      if (live) setNative(out)
    })().catch(() => setNative([]))
    return () => {
      live = false
    }
  }, [doc.pdf, doc.numPages])

  const pending = doc.annots
  const total = (native?.length ?? 0) + pending.length
  if (native && total === 0)
    return (
      <Empty icon={<MessageSquare size={22} />} title="No comments yet">
        Use Comment in the toolbar to highlight text, add notes or draw on pages.
      </Empty>
    )

  const removeNative = async (c: NativeComment): Promise<void> => {
    const ok = await useDocs.getState().apply(doc.id, 'Delete comment', (b) => deleteNativeAnnotation(b, c.page, c.id))
    if (ok) toast.ok('Comment deleted')
  }

  return (
    <ul className="comment-list">
      {pending.map((a) => (
        <li key={a.id} className="comment">
          <button
            className="comment-main"
            onClick={() => {
              useDocs.getState().goTo(doc.id, a.page)
              useUi.getState().set({ selectedAnnot: a.id, toolGroup: useUi.getState().toolGroup ?? 'comment' })
              useUi.getState().setTool('select')
            }}
          >
            <span className="comment-kind">
              <i className="swatch" style={{ background: a.color }} />
              {KIND_LABEL[a.kind]} · page {a.page + 1}
              <em className="badge">unsaved</em>
            </span>
            {a.text && <span className="comment-text">{a.text}</span>}
          </button>
          <button
            className="icon-btn sm"
            aria-label="Delete"
            onClick={() => useDocs.getState().setAnnots(doc.id, doc.annots.filter((x) => x.id !== a.id), 'Delete comment')}
          >
            <Trash2 size={13} />
          </button>
        </li>
      ))}
      {native?.map((c) => (
        <li key={c.id} className="comment">
          <button className="comment-main" onClick={() => useDocs.getState().goTo(doc.id, c.page)}>
            <span className="comment-kind">
              {c.subtype.replace(/([a-z])([A-Z])/g, '$1 $2')} · page {c.page + 1}
            </span>
            {c.contents && <span className="comment-text">{c.contents}</span>}
            {c.author && <span className="comment-author">{c.author}</span>}
          </button>
          <button className="icon-btn sm" aria-label="Delete" onClick={() => removeNative(c)}>
            <Trash2 size={13} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/* ---------------- Form fields ---------------- */

interface FieldRow {
  name: string
  type: string
  value: string
  page: number
}

function Fields({ doc }: { doc: Doc }): ReactNode {
  const [rows, setRows] = useState<FieldRow[] | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const objs = (await doc.pdf.getFieldObjects()) as Record<string, { type: string; value: unknown; page?: number }[]> | null
      const out: FieldRow[] = []
      for (const [name, list] of Object.entries(objs ?? {})) {
        const f = list.find((x) => x.type) ?? list[0]
        if (!f?.type) continue
        out.push({ name, type: f.type, value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? ''), page: f.page ?? 0 })
      }
      if (live) setRows(out)
    })().catch(() => setRows([]))
    return () => {
      live = false
    }
  }, [doc.pdf])
  if (!rows) return null
  if (rows.length === 0)
    return (
      <Empty icon={<FormInput size={22} />} title="No form fields">
        This document has no fillable fields. Use Fill &amp; Sign to type anywhere on the page.
      </Empty>
    )
  const typeLabel: Record<string, string> = { text: 'Text', checkbox: 'Checkbox', radiobutton: 'Choice', combobox: 'Dropdown', listbox: 'List', button: 'Button', signature: 'Signature' }
  return (
    <ul className="field-list">
      {rows.map((r) => (
        <li key={r.name}>
          <button onClick={() => useDocs.getState().goTo(doc.id, r.page)}>
            <span className="field-name ellipsis">{r.name}</span>
            <span className="field-meta">
              {typeLabel[r.type] ?? r.type} · page {r.page + 1}
              {r.value && r.value !== 'Off' ? ` · ${r.value}` : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/* ---------------- Attachments ---------------- */

function Attachments({ doc }: { doc: Doc }): ReactNode {
  const [items, setItems] = useState<{ filename: string; content: Uint8Array; description?: string }[] | null>(null)
  useEffect(() => {
    doc.pdf.getAttachments().then(
      (a) => setItems(Object.values((a ?? {}) as Record<string, { filename: string; content: Uint8Array; description?: string }>)),
      () => setItems([])
    )
  }, [doc.pdf])
  if (!items) return null
  if (items.length === 0) return <Empty icon={<Paperclip size={22} />} title="No attachments" />
  return (
    <ul className="field-list">
      {items.map((a) => (
        <li key={a.filename}>
          <div className="attach-row">
            <FileText size={16} />
            <span className="grow ellipsis">
              {a.filename}
              {a.description && <span className="field-meta">{a.description}</span>}
            </span>
            <button
              className="icon-btn sm"
              aria-label={`Save ${a.filename}`}
              onClick={async () => {
                const path = await window.api.saveDialog({ defaultName: a.filename, title: 'Save attachment' })
                if (path) {
                  await window.api.writeFile(path, a.content)
                  toast.ok(`Saved ${a.filename}`, { label: 'Show', run: () => window.api.showInFolder(path) })
                }
              }}
            >
              <Download size={14} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ---------------- Layers ---------------- */

interface OcGroup {
  id: string
  name: string
  visible: boolean
}

function LayersPanel({ doc }: { doc: Doc }): ReactNode {
  const [groups, setGroups] = useState<OcGroup[] | null>(null)
  useEffect(() => {
    ;(async () => {
      const config = (ocStates.get(doc.id)?.config as Awaited<ReturnType<typeof doc.pdf.getOptionalContentConfig>>) ?? (await doc.pdf.getOptionalContentConfig())
      if (!ocStates.has(doc.id)) ocStates.set(doc.id, { config, version: 0 })
      const out: OcGroup[] = []
      for (const [id, g] of config) out.push({ id, name: (g as { name: string }).name || 'Unnamed layer', visible: (g as { visible: boolean }).visible })
      setGroups(out)
    })().catch(() => setGroups([]))
  }, [doc.id, doc.pdf])
  if (!groups) return null
  if (groups.length === 0) return <Empty icon={<Layers size={22} />} title="No layers">This document has no optional content.</Empty>
  return (
    <ul className="field-list">
      {groups.map((g) => (
        <li key={g.id}>
          <label className="check layer-row">
            <input
              type="checkbox"
              checked={g.visible}
              onChange={(e) => {
                const st = ocStates.get(doc.id)!
                ;(st.config as { setVisibility: (id: string, v: boolean) => void }).setVisibility(g.id, e.target.checked)
                st.version++
                setGroups(groups.map((x) => (x.id === g.id ? { ...x, visible: e.target.checked } : x)))
                window.dispatchEvent(new Event('pdfstudio:layers'))
              }}
            />
            <span>{g.name}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
