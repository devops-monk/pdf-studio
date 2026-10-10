import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react'
import { imagesToPdf, parsePageRanges } from '@/core/ops'
import { exportImages, runOcr, toEmbeddable } from '@/core/tools'
import { loadPdf, renderToCanvas, type PDFDocumentProxy, closePdf } from '@/core/pdf'
import { useDocs, type Doc } from '@/store/docs'
import { useUi } from '@/store/ui'
import { Dialog, Segmented, toast, withBusy } from '../ui'
import { PageRange, openNewDocument } from './common'

/* ---------------- Images → PDF ---------------- */

interface Img {
  key: string
  name: string
  data: Uint8Array
  url: string
}

export function ImagesToPdfDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [imgs, setImgs] = useState<Img[]>([])
  const [size, setSize] = useState<'fit' | 'a4' | 'letter'>('a4')
  const [margin, setMargin] = useState(24)

  useEffect(() => () => imgs.forEach((i) => URL.revokeObjectURL(i.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: { name: string; data: Uint8Array }[]): void =>
    setImgs((cur) => [
      ...cur,
      ...files.map((f) => ({ key: Math.random().toString(36).slice(2), name: f.name, data: f.data, url: URL.createObjectURL(new Blob([f.data as BlobPart])) }))
    ])
  const move = (i: number, d: number): void => {
    const next = [...imgs]
    const [x] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x)
    setImgs(next)
  }

  const run = (): void => {
    withBusy('Creating PDF…', async (progress) => {
      const inputs = []
      for (const [k, im] of imgs.entries()) {
        inputs.push({ name: im.name, ...(await toEmbeddable(im)) })
        progress((k + 1) / imgs.length)
      }
      const bytes = await imagesToPdf(inputs, { pageSize: size, margin: size === 'fit' ? 0 : margin })
      onClose()
      await openNewDocument(imgs.length === 1 ? `${imgs[0].name.replace(/\.[^.]+$/, '')}.pdf` : 'Images.pdf', bytes)
      useUi.getState().set({ home: false })
    })
  }

  return (
    <Dialog
      title="Create PDF from images"
      width={640}
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{imgs.length ? `${imgs.length} image${imgs.length === 1 ? '' : 's'}, one per page` : ''}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!imgs.length} onClick={run}>
            Create PDF
          </button>
        </>
      }
    >
      <div
        className="img-grid"
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault()
          e.stopPropagation()
          const files = []
          for (const f of Array.from(e.dataTransfer.files)) if (f.type.startsWith('image/')) files.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
          add(files)
        }}
      >
        {imgs.map((im, i) => (
          <figure key={im.key} className="img-tile">
            <img src={im.url} alt={im.name} />
            <figcaption className="ellipsis">{im.name}</figcaption>
            <div className="img-tile-actions">
              <button className="icon-btn sm" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowLeft size={13} />
              </button>
              <button className="icon-btn sm" aria-label="Move later" disabled={i === imgs.length - 1} onClick={() => move(i, 1)}>
                <ArrowRight size={13} />
              </button>
              <button className="icon-btn sm" aria-label="Remove" onClick={() => setImgs(imgs.filter((x) => x.key !== im.key))}>
                <X size={13} />
              </button>
            </div>
          </figure>
        ))}
        <button className="img-add" onClick={async () => add(await window.api.openImages())}>
          <ImagePlus size={22} />
          <span>Add images</span>
          <span className="faint small">or drop them here</span>
        </button>
      </div>
      <div className="row wrap">
        <div className="field">
          <span>Page size</span>
          <Segmented
            value={size}
            onChange={setSize}
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
              { value: 'fit', label: 'Fit image' }
            ]}
          />
        </div>
        {size !== 'fit' && (
          <label className="field" style={{ width: 120 }}>
            <span>Margin (pt)</span>
            <input className="input" type="number" min={0} max={144} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
          </label>
        )}
      </div>
    </Dialog>
  )
}

/* ---------------- Export images ---------------- */

export function ExportImagesDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [dpi, setDpi] = useState(150)
  const [quality, setQuality] = useState(0.9)
  const [range, setRange] = useState('')
  const pages = range.trim() ? parsePageRanges(range, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i)
  const run = (): void => {
    if (!pages) return
    onClose()
    exportImages(doc, { format, dpi, pages, quality })
  }
  return (
    <Dialog
      title="Export pages as images"
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pages} onClick={run}>
            Export {pages?.length ?? ''} page{pages?.length === 1 ? '' : 's'}…
          </button>
        </>
      }
    >
      <div className="field">
        <span>Format</span>
        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG (sharp)' },
            { value: 'jpg', label: 'JPEG (smaller)' }
          ]}
        />
      </div>
      <label className="field">
        <span>Resolution</span>
        <select className="select" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
          <option value={72}>72 dpi — screen</option>
          <option value={150}>150 dpi — standard</option>
          <option value={300}>300 dpi — print</option>
          <option value={600}>600 dpi — high detail</option>
        </select>
      </label>
      {format === 'jpg' && (
        <label className="field">
          <span>Quality · {Math.round(quality * 100)}%</span>
          <input type="range" min={0.4} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
        </label>
      )}
      <PageRange count={doc.numPages} value={range} onChange={setRange} label="Pages (leave empty for all)" />
    </Dialog>
  )
}

/* ---------------- OCR ---------------- */

export function OcrDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [range, setRange] = useState('')
  const [skip, setSkip] = useState(true)
  const pages = range.trim() ? parsePageRanges(range, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i)
  const run = (): void => {
    if (!pages) return
    onClose()
    runOcr(doc, { pages, skipTextPages: skip })
  }
  return (
    <Dialog
      title="Recognize text"
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pages} onClick={run}>
            Recognize text
          </button>
        </>
      }
    >
      <p className="muted">
        Finds the words in scanned pages and adds an invisible text layer, so you can search, select and copy them. The pages look exactly the same. Recognition runs on this computer, in English.
      </p>
      <PageRange count={doc.numPages} value={range} onChange={setRange} label="Pages (leave empty for all)" />
      <label className="check">
        <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
        Skip pages that already have text
      </label>
    </Dialog>
  )
}

/* ---------------- Compare ---------------- */

interface Side {
  name: string
  pdf: PDFDocumentProxy
}

/** Paints pixels that differ in a translucent red over the newer page. */
function diffCanvas(a: HTMLCanvasElement, b: HTMLCanvasElement): { canvas: HTMLCanvasElement; changed: number } {
  const w = Math.max(a.width, b.width)
  const h = Math.max(a.height, b.height)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(b, 0, 0)
  const da = a.getContext('2d')!.getImageData(0, 0, w, h).data
  const db = b.getContext('2d')!.getImageData(0, 0, w, h).data
  const img = ctx.getImageData(0, 0, w, h)
  let changed = 0
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
    if (d > 60) {
      changed++
      img.data[i] = 235
      img.data[i + 1] = Math.round(img.data[i + 1] * 0.35)
      img.data[i + 2] = Math.round(img.data[i + 2] * 0.35)
    } else {
      // Fade unchanged content so the differences stand out.
      img.data[i] = 255 - (255 - img.data[i]) * 0.35
      img.data[i + 1] = 255 - (255 - img.data[i + 1]) * 0.35
      img.data[i + 2] = 255 - (255 - img.data[i + 2]) * 0.35
    }
  }
  ctx.putImageData(img, 0, 0)
  return { canvas: out, changed }
}

export function CompareDialog({ onClose }: { onClose: () => void }): ReactNode {
  const active = useDocs((s) => s.active())
  const [left, setLeft] = useState<Side | null>(null)
  const [right, setRight] = useState<Side | null>(null)
  const [page, setPage] = useState(0)
  const [view, setView] = useState<'side' | 'diff'>('diff')
  const [summary, setSummary] = useState<number[] | null>(null)
  const [images, setImages] = useState<{ a: string; b: string; diff: string; changed: number } | null>(null)
  const scanning = useRef(false)

  useEffect(() => {
    if (!active) return
    useDocs
      .getState()
      .committed(active.id)
      .then(loadPdf)
      .then((pdf) => setLeft({ name: active.name, pdf }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (left) closePdf(left.pdf)
      if (right) closePdf(right.pdf)
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const pick = async (set: (s: Side) => void, title: string): Promise<void> => {
    const [f] = await window.api.openPdfs({ title })
    if (!f) return
    try {
      set({ name: f.name, pdf: await loadPdf(f.data) })
      setSummary(null)
    } catch {
      toast.error(`${f.name} could not be opened.`)
    }
  }

  const pages = left && right ? Math.max(left.pdf.numPages, right.pdf.numPages) : 0

  const render = async (pdf: PDFDocumentProxy, i: number, width: number): Promise<HTMLCanvasElement> => {
    if (i >= pdf.numPages) {
      const c = document.createElement('canvas')
      c.width = width
      c.height = Math.round(width * 1.294)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#f1f1f1'
      ctx.fillRect(0, 0, c.width, c.height)
      return c
    }
    const p = await pdf.getPage(i + 1)
    return renderToCanvas(p, width / p.getViewport({ scale: 1 }).width)
  }

  useEffect(() => {
    if (!left || !right) return
    let live = true
    ;(async () => {
      const a = await render(left.pdf, page, 520)
      const b = await render(right.pdf, page, 520)
      const d = diffCanvas(a, b)
      if (live) setImages({ a: a.toDataURL(), b: b.toDataURL(), diff: d.canvas.toDataURL(), changed: d.changed })
    })()
    return () => {
      live = false
    }
  }, [left, right, page])

  // Scan every page at low resolution to list the ones that changed.
  useEffect(() => {
    if (!left || !right || scanning.current) return
    scanning.current = true
    ;(async () => {
      const changed: number[] = []
      for (let i = 0; i < pages; i++) {
        const a = await render(left.pdf, i, 160)
        const b = await render(right.pdf, i, 160)
        if (diffCanvas(a, b).changed > 8) changed.push(i)
      }
      setSummary(changed)
      scanning.current = false
    })()
  }, [left, right, pages])

  return (
    <Dialog
      title="Compare files"
      width={1120}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="compare-head">
        <div className="compare-pick">
          <span className="faint small">Older</span>
          <button className="btn sm" onClick={() => pick(setLeft, 'Choose the older version')}>
            {left ? left.name : 'Choose file…'}
          </button>
        </div>
        <div className="compare-pick">
          <span className="faint small">Newer</span>
          <button className="btn sm" onClick={() => pick(setRight, 'Choose the newer version')}>
            {right ? right.name : 'Choose file…'}
          </button>
        </div>
        <span className="grow" />
        {left && right && (
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'diff', label: 'Highlight changes' },
              { value: 'side', label: 'Side by side' }
            ]}
          />
        )}
      </div>
      {left && right ? (
        <div className="compare-body">
          <aside className="compare-pages">
            <div className="faint small">{summary === null ? 'Scanning pages…' : summary.length === 0 ? 'No visual differences.' : `${summary.length} of ${pages} pages differ`}</div>
            <ul>
              {Array.from({ length: pages }, (_, i) => (
                <li key={i}>
                  <button className={i === page ? 'on' : ''} onClick={() => setPage(i)}>
                    Page {i + 1}
                    {summary?.includes(i) && <i className="diff-dot" aria-label="changed" />}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className={`compare-view ${view}`}>
            {images ? (
              view === 'side' ? (
                <>
                  <img src={images.a} alt="Older page" />
                  <img src={images.b} alt="Newer page" />
                </>
              ) : (
                <img src={images.diff} alt="Differences highlighted" />
              )
            ) : (
              <div className="preview-loading" />
            )}
          </div>
        </div>
      ) : (
        <p className="muted">Choose two versions of a document. Changed areas are highlighted in red.</p>
      )}
    </Dialog>
  )
}
