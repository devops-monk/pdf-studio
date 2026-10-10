import type { PDFDocumentProxy } from './pdf'
import type { Rect } from './types'

interface PageText {
  text: string
  /** Text items with their offsets in `text` and PDF-space geometry. */
  items: { start: number; end: number; transform: number[]; width: number; height: number }[]
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageText>>>()

/** Text of a page, built the same way the viewer builds offsets for highlighting. */
export function getPageText(pdf: PDFDocumentProxy, index: number): Promise<PageText> {
  let pages = cache.get(pdf)
  if (!pages) cache.set(pdf, (pages = new Map()))
  let entry = pages.get(index)
  if (!entry) {
    entry = (async () => {
      const page = await pdf.getPage(index + 1)
      const content = await page.getTextContent()
      let text = ''
      const items: PageText['items'] = []
      for (const it of content.items) {
        if (!('str' in it)) continue
        items.push({ start: text.length, end: text.length + it.str.length, transform: it.transform, width: it.width, height: it.height })
        text += it.str
        if (it.hasEOL) text += '\n'
      }
      return { text, items }
    })()
    pages.set(index, entry)
  }
  return entry
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildMatcher(query: string, opts: { matchCase: boolean; wholeWord: boolean }): RegExp | null {
  const q = query.trim()
  if (!q) return null
  // Let a single space in the query match any run of whitespace, including line breaks.
  const body = q.split(/\s+/).map(escapeRegExp).join('\\s+')
  return new RegExp(opts.wholeWord ? `\\b${body}\\b` : body, opts.matchCase ? 'g' : 'gi')
}

export async function findAll(
  pdf: PDFDocumentProxy,
  query: string,
  opts: { matchCase: boolean; wholeWord: boolean },
  isCancelled: () => boolean = () => false
): Promise<{ page: number; start: number; end: number }[]> {
  const re = buildMatcher(query, opts)
  if (!re) return []
  const out: { page: number; start: number; end: number }[] = []
  for (let i = 0; i < pdf.numPages; i++) {
    if (isCancelled()) return out
    const { text } = await getPageText(pdf, i)
    for (const m of text.matchAll(re)) {
      if (m[0].length) out.push({ page: i, start: m.index!, end: m.index! + m[0].length })
    }
  }
  return out
}

/** PDF-space boxes covering a character range on a page (one per text item touched). */
export async function rangeRects(pdf: PDFDocumentProxy, page: number, start: number, end: number): Promise<Rect[]> {
  const { items } = await getPageText(pdf, page)
  const rects: Rect[] = []
  for (const it of items) {
    if (it.end <= start || it.start >= end || it.end === it.start) continue
    const len = it.end - it.start
    const from = (Math.max(start, it.start) - it.start) / len
    const to = (Math.min(end, it.end) - it.start) / len
    const [a, b, , , e, f] = it.transform
    const angle = Math.atan2(b, a)
    const fontH = it.height || Math.hypot(a, b)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Corners of the run in text direction: baseline from..to, descent below, ascent above.
    const along = [from * it.width, to * it.width]
    const across = [-fontH * 0.22, fontH * 0.95]
    const pts: [number, number][] = []
    for (const u of along) for (const v of across) pts.push([e + u * cos - v * sin, f + u * sin + v * cos])
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
  }
  return rects
}
