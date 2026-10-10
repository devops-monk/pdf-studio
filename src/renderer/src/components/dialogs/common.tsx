import { useEffect, useState, type ReactNode } from 'react'
import { loadPdf, renderToCanvas, closePdf } from '@/core/pdf'
import { extractPages, parsePageRanges } from '@/core/ops'
import { useDocs, type Doc } from '@/store/docs'
import { toast } from '../ui'

/** Opens freshly made bytes as a new, unsaved document tab. */
export async function openNewDocument(name: string, bytes: Uint8Array): Promise<void> {
  const doc = await useDocs.getState().open({ name, path: null, data: bytes })
  if (doc) useDocs.getState().patch(doc.id, { dirty: true })
}

export async function saveBytesAs(defaultName: string, bytes: Uint8Array): Promise<string | null> {
  const path = await window.api.saveDialog({ defaultName, title: 'Save PDF' })
  if (!path) return null
  await window.api.writeFile(path, bytes)
  toast.ok(`Saved ${path.split(/[\\/]/).pop()}`, { label: 'Show', run: () => window.api.showInFolder(path) })
  return path
}

/** Page-range text field with validation against the page count. */
export function PageRange(props: { count: number; value: string; onChange: (v: string) => void; label?: string }): ReactNode {
  const valid = props.value.trim() === '' || parsePageRanges(props.value, props.count) !== null
  return (
    <label className="field">
      <span>{props.label ?? 'Pages'}</span>
      <input className={`input${valid ? '' : ' invalid'}`} value={props.value} placeholder={`e.g. 1-3, 5, 8-${props.count}`} onChange={(e) => props.onChange(e.target.value)} />
      <span className="field-hint">{valid ? `Use page numbers and ranges. The document has ${props.count} pages.` : `Enter pages between 1 and ${props.count}, like 1-3, 5.`}</span>
    </label>
  )
}

export function rangeText(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(i === j ? `${sorted[i] + 1}` : `${sorted[i] + 1}-${sorted[j] + 1}`)
    i = j
  }
  return parts.join(', ')
}

/**
 * Live preview of an operation on one page: the page is extracted, the
 * operation runs on it for real, and the result is rendered.
 */
export function usePagePreview(doc: Doc, page: number, op: (bytes: Uint8Array) => Promise<Uint8Array>, deps: unknown[]): string | null {
  const [single, setSingle] = useState<Uint8Array | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    useDocs
      .getState()
      .committed(doc.id)
      .then((b) => extractPages(b, [page]))
      .then(setSingle, () => setSingle(null))
  }, [doc.id, doc.version, page])
  useEffect(() => {
    if (!single) return
    let live = true
    const t = setTimeout(async () => {
      try {
        const bytes = await op(single)
        const pdf = await loadPdf(bytes)
        const p = await pdf.getPage(1)
        const v = p.getViewport({ scale: 1 })
        const canvas = await renderToCanvas(p, Math.min(2, 520 / v.width))
        closePdf(pdf)
        if (live) setUrl(canvas.toDataURL('image/png'))
      } catch {
        // A transient bad input (e.g. empty text) just keeps the last preview.
      }
    }, 220)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [single, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return url
}

export function Preview({ url, label }: { url: string | null; label?: string }): ReactNode {
  return (
    <figure className="preview">
      <div className="preview-frame">{url ? <img src={url} alt={label ?? 'Preview'} /> : <div className="preview-loading" />}</div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  )
}
