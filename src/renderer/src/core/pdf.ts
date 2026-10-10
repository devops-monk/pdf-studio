import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type { PDFDocumentProxy, PDFPageProxy, PageViewport }

const assetBase = new URL('./pdfjs/', document.baseURI).href

export class PasswordRequired extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'Password required')
  }
}

/**
 * Opens bytes with pdf.js. pdf.js transfers the buffer to its worker, so it
 * always receives a copy and the caller's bytes stay usable.
 */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    iccUrl: assetBase + 'iccs/',
    enableXfa: false,
    isEvalSupported: false
  })
  try {
    return await task.promise
  } catch (err) {
    if (err instanceof pdfjs.PasswordException) {
      await task.destroy().catch(() => undefined)
      throw new PasswordRequired(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    }
    throw err
  }
}

/** Largest canvas we allow, in pixels. Beyond this pages render at reduced density. */
const MAX_CANVAS_PIXELS = 16_777_216

export function outputScale(viewport: PageViewport): number {
  const dpr = window.devicePixelRatio || 1
  const pixels = viewport.width * viewport.height * dpr * dpr
  return pixels > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)) : dpr
}

/** Renders a page into a fresh canvas at the given scale (CSS px per PDF point). */
export async function renderToCanvas(
  page: PDFPageProxy,
  scale: number,
  opts: { rotation?: number; annotations?: boolean; background?: string } = {}
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale, rotation: (page.rotate + (opts.rotation ?? 0)) % 360 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = opts.background ?? '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    annotationMode: opts.annotations === false ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE
  }).promise
  return canvas
}

export function canvasToBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.9): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Could not encode image'))
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      },
      type,
      quality
    )
  })
}

/** Plain text of one page, with line breaks where pdf.js reports them. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent()
  let out = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out
}

/** Resolves an outline / link destination to a zero-based page index. */
export async function destToPageIndex(pdf: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null)
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const target = explicit[0]
    if (typeof target === 'number') return target
    if (target && typeof target === 'object') return await pdf.getPageIndex(target as { num: number; gen: number })
  } catch {
    // Broken destinations simply don't navigate.
  }
  return null
}

export function fileStem(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
