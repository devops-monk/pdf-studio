/**
 * Tools that need page rendering (pdf.js) on top of byte editing (pdf-lib).
 */
import { canvasToBytes, fileStem, loadPdf, pageText, renderToCanvas, closePdf } from './pdf'
import { addInvisibleText, replacePagesWithImages, type PlacedWord } from './ops'
import type { Doc } from '@/store/docs'
import { useDocs } from '@/store/docs'
import type { Annot } from './types'
import { toast, withBusy } from '@/components/ui'

/* ---------------- Export ---------------- */

export async function exportText(doc: Doc): Promise<void> {
  const path = await window.api.saveDialog({ defaultName: `${fileStem(doc.name)}.txt`, kind: 'txt', title: 'Export as text' })
  if (!path) return
  await withBusy('Extracting text…', async (progress) => {
    const parts: string[] = []
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.pdf.getPage(i + 1)
      parts.push(await pageText(page))
      progress((i + 1) / doc.numPages)
    }
    const text = parts.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}\n`).join('\n')
    await window.api.writeFile(path, new TextEncoder().encode(text))
    toast.ok(`Exported text from ${doc.numPages} pages`, { label: 'Show file', run: () => window.api.showInFolder(path) })
  })
}

export async function exportImages(doc: Doc, opts: { format: 'png' | 'jpg'; dpi: number; pages: number[]; quality: number }): Promise<void> {
  const folder = await window.api.chooseFolder('Choose where to save the images')
  if (!folder) return
  await withBusy('Exporting pages…', async (progress) => {
    const files: { name: string; data: Uint8Array }[] = []
    const stem = fileStem(doc.name)
    const digits = String(doc.numPages).length
    for (const [k, i] of opts.pages.entries()) {
      const page = await doc.pdf.getPage(i + 1)
      const canvas = await renderToCanvas(page, opts.dpi / 72)
      const data = await canvasToBytes(canvas, opts.format === 'png' ? 'image/png' : 'image/jpeg', opts.quality)
      files.push({ name: `${stem}-page-${String(i + 1).padStart(digits, '0')}.${opts.format}`, data })
      progress((k + 1) / opts.pages.length)
    }
    const written = await window.api.writeMany(folder, files)
    toast.ok(`Saved ${written.length} image${written.length === 1 ? '' : 's'}`, { label: 'Show', run: () => window.api.showInFolder(written[0]) })
  })
}

/* ---------------- Print ---------------- */

export async function printDocument(doc: Doc): Promise<void> {
  const urls: string[] = []
  const ok = await withBusy('Preparing to print…', async (progress) => {
    const bytes = await useDocs.getState().committed(doc.id)
    const pdf = await loadPdf(bytes)
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const canvas = await renderToCanvas(page, 150 / 72)
        const blob = new Blob([(await canvasToBytes(canvas, 'image/jpeg', 0.92)) as BlobPart], { type: 'image/jpeg' })
        urls.push(URL.createObjectURL(blob))
        progress(i / pdf.numPages)
      }
    } finally {
      closePdf(pdf)
    }
    return true
  })
  if (!ok) return
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.append(frame)
  const d = frame.contentDocument!
  d.open()
  d.write(`<!doctype html><html><head><title>${doc.name.replace(/</g, '')}</title><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: 100%; height: 100vh; object-fit: contain; page-break-after: always; break-after: page; }
    img:last-child { page-break-after: auto; break-after: auto; }
  </style></head><body>${urls.map((u) => `<img src="${u}">`).join('')}</body></html>`)
  d.close()
  await Promise.all(Array.from(d.images).map((img) => (img.complete ? Promise.resolve() : new Promise((r) => (img.onload = img.onerror = r)))))
  frame.contentWindow!.focus()
  frame.contentWindow!.print()
  setTimeout(() => {
    frame.remove()
    urls.forEach((u) => URL.revokeObjectURL(u))
  }, 60_000)
}

/* ---------------- Redaction ---------------- */

/**
 * Burns redaction boxes into the affected pages. Those pages are replaced by
 * images of themselves, so the covered text, images and vector content no
 * longer exist in the file.
 */
export async function applyRedactions(doc: Doc, opts: { dpi: number } = { dpi: 200 }): Promise<void> {
  const marks = doc.annots.filter((a) => a.kind === 'redact')
  if (marks.length === 0) {
    toast.info('Mark areas to redact first: drag over the page with the Redact tool.')
    return
  }
  const byPage = new Map<number, Annot[]>()
  for (const m of marks) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m])

  await withBusy('Applying redactions…', async (progress) => {
    const ok = await useDocs.getState().apply(doc.id, 'Apply redactions', async (bytes) => {
      const pdf = await loadPdf(bytes)
      try {
        const images = new Map<number, { bytes: Uint8Array; type: 'jpg' }>()
        let done = 0
        for (const [index, list] of byPage) {
          const page = await pdf.getPage(index + 1)
          // Render unrotated: the replacement page keeps the original /Rotate.
          const viewport = page.getViewport({ scale: opts.dpi / 72, rotation: 0 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvas, canvasContext: ctx, viewport }).promise
          ctx.fillStyle = '#000'
          for (const m of list) {
            const [x1, y1] = viewport.convertToViewportPoint(m.rect![0], m.rect![1])
            const [x2, y2] = viewport.convertToViewportPoint(m.rect![2], m.rect![3])
            ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
          }
          images.set(index, { bytes: await canvasToBytes(canvas, 'image/jpeg', 0.9), type: 'jpg' })
          progress(++done / byPage.size)
        }
        return await replacePagesWithImages(bytes, images)
      } finally {
        closePdf(pdf)
      }
    })
    if (ok) {
      const d = useDocs.getState().get(doc.id)!
      useDocs.getState().setAnnotsLive(doc.id, d.annots.filter((a) => a.kind !== 'redact'))
      toast.ok(`Redacted ${marks.length} area${marks.length === 1 ? '' : 's'} on ${byPage.size} page${byPage.size === 1 ? '' : 's'}. Save to keep the result.`)
    }
  })
}

/* ---------------- OCR ---------------- */

export async function runOcr(doc: Doc, opts: { pages: number[]; skipTextPages: boolean }): Promise<void> {
  const SCALE = 3
  await withBusy('Recognizing text…', async (progress) => {
    let recognized = 0
    let skipped = 0
    const ok = await useDocs.getState().apply(doc.id, 'Recognize text', async (bytes) => {
      const pdf = await loadPdf(bytes)
      try {
        const placed = new Map<number, PlacedWord[]>()
        for (const [k, i] of opts.pages.entries()) {
          const page = await pdf.getPage(i + 1)
          if (opts.skipTextPages && (await pageText(page)).trim().length > 20) {
            skipped++
            progress((k + 1) / opts.pages.length)
            continue
          }
          const viewport = page.getViewport({ scale: SCALE })
          const canvas = await renderToCanvas(page, SCALE, { annotations: false })
          const words = await window.api.ocr(await canvasToBytes(canvas, 'image/png'))
          const out: PlacedWord[] = []
          for (const w of words) {
            const [bx, by] = viewport.convertToPdfPoint(w.x0, w.y1)
            const [ex, ey] = viewport.convertToPdfPoint(w.x1, w.y1)
            const width = Math.hypot(ex - bx, ey - by)
            const size = Math.max(2, ((w.y1 - w.y0) / SCALE) * 0.92)
            out.push({ text: w.text, x: bx, y: by + size * 0.18, width, size, angle: page.rotate })
          }
          placed.set(i, out)
          recognized++
          progress((k + 1) / opts.pages.length)
        }
        return await addInvisibleText(bytes, placed)
      } finally {
        closePdf(pdf)
      }
    })
    if (ok) {
      toast.ok(
        recognized
          ? `Recognized text on ${recognized} page${recognized === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} that already had text` : ''}. You can now search and select it.`
          : 'Every page already has text, so nothing needed recognizing.'
      )
    }
  })
}

/* ---------------- Compress as images ---------------- */

export async function rasterizeAll(bytes: Uint8Array, dpi: number, quality: number, progress: (f: number) => void): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  try {
    const images = new Map<number, { bytes: Uint8Array; type: 'jpg' }>()
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1)
      const viewport = page.getViewport({ scale: dpi / 72, rotation: 0 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      images.set(i, { bytes: await canvasToBytes(canvas, 'image/jpeg', quality), type: 'jpg' })
      progress((i + 1) / pdf.numPages)
    }
    return await replacePagesWithImages(bytes, images)
  } finally {
    closePdf(pdf)
  }
}

/* ---------------- Images ---------------- */

/** Normalises any browser-decodable image to PNG or JPEG bytes pdf-lib can embed. */
export async function toEmbeddable(file: { name: string; data: Uint8Array }): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' }> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.png')) return { bytes: file.data, type: 'png' }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { bytes: file.data, type: 'jpg' }
  const bitmap = await createImageBitmap(new Blob([file.data as BlobPart]))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return { bytes: await canvasToBytes(canvas, 'image/png'), type: 'png' }
}

/** Reads an image file into a PNG data URL plus its pixel size (for placing on a page). */
export async function imageToDataUrl(data: Uint8Array): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([data as BlobPart]))
  const max = 2000
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * s)
  canvas.height = Math.round(bitmap.height * s)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}
