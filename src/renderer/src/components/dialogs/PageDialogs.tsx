import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, FilePlus, GripVertical, X } from 'lucide-react'
import { combine, extractPages, deletePages, groupsAt, groupsEvery, insertBlankPages, insertFromFile, parsePageRanges, splitDocument } from '@/core/ops'
import { destToPageIndex, fileStem, formatBytes, loadPdf, closePdf } from '@/core/pdf'
import { useDocs, type Doc } from '@/store/docs'
import { useUi } from '@/store/ui'
import { Dialog, Segmented, toast, withBusy } from '../ui'
import { PageRange, openNewDocument, rangeText, saveBytesAs } from './common'

/* ---------------- Combine ---------------- */

interface Entry {
  key: string
  name: string
  bytes: Uint8Array
  pages: number | null
}

export function CombineDialog({ onClose }: { onClose: () => void }): ReactNode {
  const docs = useDocs((s) => s.docs)
  const [files, setFiles] = useState<Entry[]>([])
  const [bookmarks, setBookmarks] = useState(true)
  const [dragKey, setDragKey] = useState<string | null>(null)

  const addEntries = async (list: { name: string; bytes: Uint8Array }[]): Promise<void> => {
    const added: Entry[] = []
    for (const f of list) {
      let pages: number | null = null
      try {
        const pdf = await loadPdf(f.bytes)
        pages = pdf.numPages
        closePdf(pdf)
      } catch {
        toast.error(`${f.name} is not a readable PDF and was skipped.`)
        continue
      }
      added.push({ key: Math.random().toString(36).slice(2), name: f.name, bytes: f.bytes, pages })
    }
    setFiles((cur) => [...cur, ...added])
  }

  // Start with the open documents, which is what people usually want to merge.
  useEffect(() => {
    ;(async () => {
      const list: { name: string; bytes: Uint8Array }[] = []
      for (const d of useDocs.getState().docs) list.push({ name: d.name, bytes: await useDocs.getState().committed(d.id) })
      if (list.length > 1) addEntries(list)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const browse = async (): Promise<void> => {
    const picked = await window.api.openPdfs({ multiple: true, title: 'Choose PDFs to combine' })
    addEntries(picked.map((p) => ({ name: p.name, bytes: p.data })))
  }
  const moveBy = (i: number, d: number): void => {
    const next = [...files]
    const [x] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x)
    setFiles(next)
  }
  const total = files.reduce((n, f) => n + (f.pages ?? 0), 0)

  const run = (): void => {
    withBusy('Combining files…', async () => {
      const bytes = await combine(files, bookmarks)
      onClose()
      await openNewDocument(`${fileStem(files[0].name)} combined.pdf`, bytes)
      useUi.getState().set({ home: false })
      toast.ok(`Combined ${files.length} files into ${total} pages. Save to keep it.`)
    })
  }

  return (
    <Dialog
      title="Combine files"
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{files.length ? `${files.length} files · ${total} pages` : ''}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={files.length < 2} onClick={run}>
            Combine
          </button>
        </>
      }
    >
      <ul
        className="file-list"
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={async (e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          e.stopPropagation()
          const list = []
          for (const f of Array.from(e.dataTransfer.files)) if (f.name.toLowerCase().endsWith('.pdf')) list.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
          addEntries(list)
        }}
      >
        {files.map((f, i) => (
          <li
            key={f.key}
            className={`file-row${dragKey === f.key ? ' dragging' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragKey(f.key)
              e.dataTransfer.setData('text/x-entry', f.key)
            }}
            onDragEnd={() => setDragKey(null)}
            onDragOver={(e) => {
              if (!dragKey || dragKey === f.key) return
              e.preventDefault()
              const from = files.findIndex((x) => x.key === dragKey)
              if (from !== i) moveBy(from, i - from)
            }}
          >
            <GripVertical size={14} className="faint grip" />
            <span className="file-index">{i + 1}</span>
            <span className="grow ellipsis">{f.name}</span>
            <span className="faint small">
              {f.pages} {f.pages === 1 ? 'page' : 'pages'} · {formatBytes(f.bytes.length)}
            </span>
            <button className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => moveBy(i, -1)}>
              <ArrowUp size={13} />
            </button>
            <button className="icon-btn sm" aria-label="Move down" disabled={i === files.length - 1} onClick={() => moveBy(i, 1)}>
              <ArrowDown size={13} />
            </button>
            <button className="icon-btn sm" aria-label="Remove" onClick={() => setFiles(files.filter((x) => x.key !== f.key))}>
              <X size={13} />
            </button>
          </li>
        ))}
        <li>
          <button className="file-add" onClick={browse}>
            <FilePlus size={16} />
            {files.length ? 'Add more files' : 'Add PDFs, or drop them here'}
          </button>
        </li>
      </ul>
      {docs.length > 0 && files.length === 0 && <p className="field-hint">Tip: files that are open in tabs are added automatically when two or more are open.</p>}
      <label className="check">
        <input type="checkbox" checked={bookmarks} onChange={(e) => setBookmarks(e.target.checked)} />
        Add a bookmark for each file
      </label>
    </Dialog>
  )
}

/* ---------------- Split ---------------- */

type SplitMode = 'every' | 'at' | 'bookmarks'

export function SplitDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [mode, setMode] = useState<SplitMode>('every')
  const [every, setEvery] = useState(1)
  const [at, setAt] = useState('')
  const [stem, setStem] = useState(fileStem(doc.name))
  const [bookmarkStarts, setBookmarkStarts] = useState<{ page: number; title: string }[] | null>(null)

  useEffect(() => {
    ;(async () => {
      const outline = (await doc.pdf.getOutline()) ?? []
      const starts: { page: number; title: string }[] = []
      for (const item of outline) {
        const p = await destToPageIndex(doc.pdf, item.dest)
        if (p != null) starts.push({ page: p, title: item.title })
      }
      setBookmarkStarts(starts.sort((a, b) => a.page - b.page))
    })().catch(() => setBookmarkStarts([]))
  }, [doc.pdf])

  const n = doc.numPages
  const atPages = parsePageRanges(at, n)
  const groups =
    mode === 'every'
      ? groupsEvery(n, Math.max(1, every))
      : mode === 'at'
        ? atPages
          ? groupsAt(n, atPages)
          : null
        : bookmarkStarts && bookmarkStarts.length
          ? groupsAt(n, bookmarkStarts.map((b) => b.page))
          : null

  const names = (groups ?? []).map((g, i) => {
    if (mode === 'bookmarks' && bookmarkStarts) {
      const b = bookmarkStarts.find((x) => x.page === g[0])
      if (b) return `${stem} - ${b.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)}.pdf`
    }
    return `${stem} - part ${String(i + 1).padStart(String(groups!.length).length, '0')}.pdf`
  })

  const run = async (): Promise<void> => {
    if (!groups) return
    const folder = await window.api.chooseFolder('Choose where to save the parts')
    if (!folder) return
    await withBusy('Splitting…', async () => {
      const base = await useDocs.getState().committed(doc.id)
      const parts = await splitDocument(base, groups)
      const written = await window.api.writeMany(
        folder,
        parts.map((data, i) => ({ name: names[i], data }))
      )
      onClose()
      toast.ok(`Created ${written.length} files`, { label: 'Show', run: () => window.api.showInFolder(written[0]) })
    })
  }

  return (
    <Dialog
      title="Split document"
      width={520}
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <span className="foot-note">{groups ? `Creates ${groups.length} file${groups.length === 1 ? '' : 's'} from ${n} pages` : ''}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!groups || groups.length < 2} onClick={run}>
            Split…
          </button>
        </>
      }
    >
      <Segmented<SplitMode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'every', label: 'Every n pages' },
          { value: 'at', label: 'Before pages' },
          { value: 'bookmarks', label: 'By bookmarks' }
        ]}
      />
      {mode === 'every' && (
        <label className="field">
          <span>Pages per file</span>
          <input className="input" type="number" min={1} max={n} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))} />
        </label>
      )}
      {mode === 'at' && <PageRange count={n} value={at} onChange={setAt} label="Start a new file at pages" />}
      {mode === 'bookmarks' && (
        <p className="field-hint">
          {bookmarkStarts === null
            ? 'Reading bookmarks…'
            : bookmarkStarts.length
              ? `Each of the ${bookmarkStarts.length} top-level bookmarks starts a new file.`
              : 'This document has no top-level bookmarks to split at.'}
        </p>
      )}
      <label className="field">
        <span>File names start with</span>
        <input className="input" value={stem} onChange={(e) => setStem(e.target.value)} />
      </label>
      {groups && groups.length > 0 && (
        <ul className="split-preview">
          {groups.slice(0, 6).map((g, i) => (
            <li key={i}>
              <span className="ellipsis">{names[i]}</span>
              <span className="faint">{g.length === 1 ? `page ${g[0] + 1}` : `pages ${g[0] + 1}–${g.at(-1)! + 1}`}</span>
            </li>
          ))}
          {groups.length > 6 && <li className="faint">and {groups.length - 6} more</li>}
        </ul>
      )}
    </Dialog>
  )
}

/* ---------------- Extract ---------------- */

export function ExtractDialog({ doc, onClose, pages }: { doc: Doc; onClose: () => void; pages?: number[] }): ReactNode {
  const [range, setRange] = useState(pages?.length ? rangeText(pages) : `${doc.view.page + 1}`)
  const [separate, setSeparate] = useState(false)
  const [removeAfter, setRemoveAfter] = useState(false)
  const [name, setName] = useState(`${fileStem(doc.name)} extract`)
  const indices = parsePageRanges(range, doc.numPages)

  const run = async (target: 'tab' | 'file'): Promise<void> => {
    if (!indices) return
    await withBusy('Extracting pages…', async () => {
      const base = await useDocs.getState().committed(doc.id)
      if (separate) {
        const folder = await window.api.chooseFolder('Choose where to save the pages')
        if (!folder) return
        const parts = await splitDocument(base, indices.map((i) => [i]))
        const written = await window.api.writeMany(
          folder,
          parts.map((data, k) => ({ name: `${name} - page ${indices[k] + 1}.pdf`, data }))
        )
        toast.ok(`Saved ${written.length} files`, { label: 'Show', run: () => window.api.showInFolder(written[0]) })
      } else {
        const bytes = await extractPages(base, indices, name)
        if (target === 'tab') await openNewDocument(`${name}.pdf`, bytes)
        else if (!(await saveBytesAs(`${name}.pdf`, bytes))) return
      }
      if (removeAfter) {
        if (indices.length >= doc.numPages) toast.info('All pages were extracted, so the original was left unchanged.')
        else await useDocs.getState().apply(doc.id, 'Delete extracted pages', (b) => deletePages(b, indices))
      }
      onClose()
    })
  }

  return (
    <Dialog
      title="Extract pages"
      onClose={onClose}
      onSubmit={() => run('tab')}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {!separate && (
            <button className="btn" disabled={!indices} onClick={() => run('file')}>
              Save as…
            </button>
          )}
          <button className="btn primary" disabled={!indices} onClick={() => run(separate ? 'file' : 'tab')}>
            {separate ? 'Save files…' : 'Open as new document'}
          </button>
        </>
      }
    >
      <PageRange count={doc.numPages} value={range} onChange={setRange} />
      <label className="field">
        <span>File name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
        Save each page as its own file
      </label>
      <label className="check">
        <input type="checkbox" checked={removeAfter} onChange={(e) => setRemoveAfter(e.target.checked)} />
        Delete these pages from this document afterwards
      </label>
    </Dialog>
  )
}

/* ---------------- Insert ---------------- */

export function InsertDialog({ doc, onClose, at: atProp }: { doc: Doc; onClose: () => void; at?: number }): ReactNode {
  const [source, setSource] = useState<'blank' | 'file'>('file')
  const [count, setCount] = useState(1)
  const [where, setWhere] = useState<'start' | 'end' | 'after'>(atProp != null && atProp < doc.numPages ? 'after' : 'end')
  const [after, setAfter] = useState(atProp != null && atProp > 0 ? atProp : doc.view.page + 1)
  const [file, setFile] = useState<{ name: string; data: Uint8Array; pages: number } | null>(null)
  const [range, setRange] = useState('')

  const position = where === 'start' ? 0 : where === 'end' ? doc.numPages : Math.min(Math.max(after, 0), doc.numPages)
  const fileRange = file ? (range.trim() ? parsePageRanges(range, file.pages) : Array.from({ length: file.pages }, (_, i) => i)) : null

  const choose = async (): Promise<void> => {
    const [f] = await window.api.openPdfs({ title: 'Choose a PDF to insert' })
    if (!f) return
    try {
      const pdf = await loadPdf(f.data)
      setFile({ name: f.name, data: f.data, pages: pdf.numPages })
      closePdf(pdf)
    } catch {
      toast.error(`${f.name} could not be read.`)
    }
  }

  const run = (): void => {
    withBusy('Inserting pages…', async () => {
      const ok =
        source === 'blank'
          ? await useDocs.getState().apply(doc.id, count === 1 ? 'Insert blank page' : 'Insert blank pages', (b) => insertBlankPages(b, position, count))
          : await useDocs.getState().apply(doc.id, 'Insert pages', (b) => insertFromFile(b, position, file!.data, fileRange!))
      if (ok) {
        onClose()
        useDocs.getState().goTo(doc.id, position)
      }
    })
  }

  return (
    <Dialog
      title="Insert pages"
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={source === 'file' && (!file || !fileRange)} onClick={run}>
            Insert
          </button>
        </>
      }
    >
      <Segmented
        value={source}
        onChange={setSource}
        options={[
          { value: 'file', label: 'From a file' },
          { value: 'blank', label: 'Blank pages' }
        ]}
      />
      {source === 'file' ? (
        <>
          <div className="row">
            <button className="btn" onClick={choose}>
              Choose PDF…
            </button>
            <span className="ellipsis muted">{file ? `${file.name} · ${file.pages} pages` : 'No file chosen'}</span>
          </div>
          {file && <PageRange count={file.pages} value={range} onChange={setRange} label="Pages to insert (leave empty for all)" />}
        </>
      ) : (
        <label className="field">
          <span>Number of pages</span>
          <input className="input" type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />
        </label>
      )}
      <div className="field">
        <span>Where</span>
        <div className="row wrap">
          <label className="check">
            <input type="radio" name="where" checked={where === 'start'} onChange={() => setWhere('start')} /> Before the first page
          </label>
          <label className="check">
            <input type="radio" name="where" checked={where === 'end'} onChange={() => setWhere('end')} /> After the last page
          </label>
          <label className="check">
            <input type="radio" name="where" checked={where === 'after'} onChange={() => setWhere('after')} /> After page
            <input
              className="input"
              style={{ width: 70 }}
              type="number"
              min={1}
              max={doc.numPages}
              value={after}
              onFocus={() => setWhere('after')}
              onChange={(e) => setAfter(Number(e.target.value))}
            />
          </label>
        </div>
      </div>
    </Dialog>
  )
}
