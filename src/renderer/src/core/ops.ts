/**
 * Document operations. Each takes the working bytes and returns new bytes, so
 * the store can treat every edit the same way (snapshot → apply → reload).
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFPage,
  PDFRef,
  PDFStream,
  StandardFonts,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont
} from '@cantoo/pdf-lib'
import { hexToRgb } from './types'

export async function openLib(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false, password, throwOnInvalidObject: false })
}

export async function saveLib(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false })
}

async function edit(bytes: Uint8Array, fn: (doc: PDFDocument) => void | Promise<void>): Promise<Uint8Array> {
  const doc = await openLib(bytes)
  await fn(doc)
  return saveLib(doc)
}

/* ---------------- Encryption ---------------- */

export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  return doc.isEncrypted
}

/** Returns an unencrypted copy. The empty password works for restriction-only files. */
export async function decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return saveLib(await openLib(bytes, password))
}

export interface Permissions {
  printing: boolean
  copying: boolean
  modifying: boolean
  annotating: boolean
  fillingForms: boolean
  documentAssembly: boolean
}

export async function protect(
  bytes: Uint8Array,
  opts: { userPassword: string; ownerPassword?: string; permissions?: Partial<Permissions> }
): Promise<Uint8Array> {
  const doc = await openLib(bytes)
  const p = opts.permissions
  doc.encrypt({
    userPassword: opts.userPassword,
    ownerPassword: opts.ownerPassword || opts.userPassword,
    algorithm: 'AES-256',
    permissions: p && {
      printing: p.printing === false ? false : 'highResolution',
      copying: p.copying !== false,
      modifying: p.modifying !== false,
      annotating: p.annotating !== false,
      fillingForms: p.fillingForms !== false,
      documentAssembly: p.documentAssembly !== false,
      contentAccessibility: true
    }
  })
  return saveLib(doc)
}

/* ---------------- Page operations ---------------- */

export function rotatePages(bytes: Uint8Array, indices: number[], delta: number): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    for (const i of indices) {
      const page = doc.getPage(i)
      const next = (((page.getRotation().angle + delta) % 360) + 360) % 360
      page.setRotation(degrees(next))
    }
  })
}

export function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    if (indices.length >= doc.getPageCount()) throw new Error('A document needs at least one page.')
    for (const i of [...indices].sort((a, b) => b - a)) doc.removePage(i)
  })
}

/**
 * Reorders pages in place, keeping each page object (and so every link,
 * bookmark and form field that points at it) intact.
 * `order[k]` is the old index of the page that ends up at position k.
 */
export function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    const pages = doc.getPages()
    if (order.length !== pages.length) throw new Error('Page order does not match the page count.')
    // Copy inherited attributes onto each page, then rebuild a flat page tree.
    const inheritable = ['Resources', 'MediaBox', 'CropBox', 'Rotate']
    for (const p of pages) {
      for (const key of inheritable) {
        const name = PDFName.of(key)
        if (!p.node.has(name)) {
          const value = p.node.getInheritableAttribute(name)
          if (value) p.node.set(name, value)
        }
      }
    }
    const rootRef = doc.catalog.get(PDFName.of('Pages')) as PDFRef
    const root = doc.catalog.Pages()
    root.set(PDFName.of('Kids'), doc.context.obj(order.map((old) => pages[old].ref)))
    root.set(PDFName.of('Count'), PDFNumber.of(order.length))
    for (const old of order) pages[old].node.setParent(rootRef)
  })
}

/** Moves the given pages so they start at `target` (an index in the original order). */
export function movePagesOrder(count: number, moving: number[], target: number): number[] {
  const set = new Set(moving)
  const rest = [...Array(count).keys()].filter((i) => !set.has(i))
  const before = rest.filter((i) => i < target).length
  const sorted = [...moving].sort((a, b) => a - b)
  return [...rest.slice(0, before), ...sorted, ...rest.slice(before)]
}

export function duplicatePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const sorted = [...indices].sort((a, b) => b - a)
    for (const i of sorted) {
      const [copy] = await doc.copyPages(doc, [i])
      doc.insertPage(i + 1, copy)
    }
  })
}

export function insertBlankPages(bytes: Uint8Array, at: number, count = 1): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    const ref = doc.getPage(Math.min(Math.max(at - 1, 0), doc.getPageCount() - 1))
    const { width, height } = ref.getSize()
    const rotation = ref.getRotation().angle
    for (let n = 0; n < count; n++) {
      const page = doc.insertPage(at + n, [width, height])
      page.setRotation(degrees(rotation))
    }
  })
}

export function insertFromFile(bytes: Uint8Array, at: number, other: Uint8Array, pages?: number[]): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const src = await openLib(other)
    const copied = await doc.copyPages(src, pages ?? src.getPageIndices())
    copied.forEach((p, k) => doc.insertPage(at + k, p))
  })
}

export async function extractPages(bytes: Uint8Array, indices: number[], title?: string): Promise<Uint8Array> {
  const src = await openLib(bytes)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, indices)
  copied.forEach((p) => out.addPage(p))
  if (title) out.setTitle(title)
  const author = src.getAuthor()
  if (author) out.setAuthor(author)
  return saveLib(out)
}

export async function splitDocument(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const src = await openLib(bytes)
  const parts: Uint8Array[] = []
  for (const group of groups) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, group)
    copied.forEach((p) => out.addPage(p))
    parts.push(await saveLib(out))
  }
  return parts
}

/** Page groups for "split every n pages". */
export function groupsEvery(count: number, n: number): number[][] {
  const groups: number[][] = []
  for (let i = 0; i < count; i += n) groups.push([...Array(Math.min(n, count - i)).keys()].map((k) => i + k))
  return groups
}

/** Page groups for "split before these pages" (zero-based starts). */
export function groupsAt(count: number, starts: number[]): number[][] {
  const cuts = [...new Set([0, ...starts.filter((s) => s > 0 && s < count)])].sort((a, b) => a - b)
  return cuts.map((s, k) => {
    const end = k + 1 < cuts.length ? cuts[k + 1] : count
    return [...Array(end - s).keys()].map((i) => s + i)
  })
}

/**
 * Parses "1-3, 5, 8-" into zero-based indices (input is one-based, as users
 * see page numbers). Returns null when the text is not a valid range list.
 */
export function parsePageRanges(text: string, count: number): number[] | null {
  const out: number[] = []
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  for (const part of parts) {
    const m = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part)
    if (!m) return null
    const isRange = part.includes('-')
    const a = m[1] ? parseInt(m[1], 10) : 1
    const b = isRange ? (m[2] ? parseInt(m[2], 10) : count) : a
    if (a < 1 || b > count || a > b) return null
    for (let p = a; p <= b; p++) out.push(p - 1)
  }
  return [...new Set(out)]
}

/* ---------------- Combine & outlines ---------------- */

interface OutlineItem {
  title: string
  page: number
}

function writeOutline(doc: PDFDocument, items: OutlineItem[]): void {
  if (items.length === 0) return
  const ctx = doc.context
  const pageRefs = doc.getPages().map((p) => p.ref)
  const rootRef = ctx.nextRef()
  const refs = items.map(() => ctx.nextRef())
  items.forEach((item, i) => {
    const dict = ctx.obj({
      Title: PDFHexString.fromText(item.title),
      Parent: rootRef,
      Dest: [pageRefs[item.page], 'Fit']
    }) as PDFDict
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
    if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
    ctx.assign(refs[i], dict)
  })
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: items.length })
  )
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

export async function combine(files: { name: string; bytes: Uint8Array }[], bookmarks = true): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const outline: OutlineItem[] = []
  for (const f of files) {
    const src = await openLib(f.bytes)
    const start = out.getPageCount()
    const copied = await out.copyPages(src, src.getPageIndices())
    copied.forEach((p) => out.addPage(p))
    outline.push({ title: f.name.replace(/\.pdf$/i, ''), page: start })
  }
  if (bookmarks) writeOutline(out, outline)
  out.setTitle(files.length ? `Combined — ${files[0].name.replace(/\.pdf$/i, '')}` : 'Combined')
  return saveLib(out)
}

/* ---------------- Display-space helpers ---------------- */

/**
 * Pages can carry a /Rotate. Stamps such as watermarks and page numbers are
 * placed in the page's *displayed* orientation so they read upright; this maps
 * displayed coordinates (origin bottom-left of the visible page) to PDF space.
 */
export function displayFrame(page: PDFPage): { width: number; height: number; rotation: number; toPdf: (x: number, y: number) => [number, number] } {
  const box = page.getCropBox()
  const W = box.width
  const H = box.height
  const R = ((page.getRotation().angle % 360) + 360) % 360
  const ox = box.x
  const oy = box.y
  const map: Record<number, (x: number, y: number) => [number, number]> = {
    0: (x, y) => [x, y],
    90: (x, y) => [W - y, x],
    180: (x, y) => [W - x, H - y],
    270: (x, y) => [y, H - x]
  }
  const f = map[R] ?? map[0]
  return {
    width: R % 180 === 0 ? W : H,
    height: R % 180 === 0 ? H : W,
    rotation: R,
    toPdf: (x, y) => {
      const [px, py] = f(x, y)
      return [px + ox, py + oy]
    }
  }
}

/** Drawing text needs WinAnsi for the standard fonts; anything else becomes '?'. */
export function winAnsiSafe(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet())
  return [...text].map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : ch === '\n' ? ch : '?')).join('')
}

/* ---------------- Watermark ---------------- */

export interface WatermarkOptions {
  text: string
  fontSize: number
  color: string
  opacity: number
  /** Counter-clockwise, as seen on screen. */
  angle: number
  layout: 'center' | 'tile'
  pages: number[] | 'all'
  bold: boolean
}

export function addWatermark(bytes: Uint8Array, o: WatermarkOptions): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const font = await doc.embedFont(o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)
    const text = winAnsiSafe(font, o.text)
    const [r, g, b] = hexToRgb(o.color)
    const indices = o.pages === 'all' ? doc.getPageIndices() : o.pages
    const textW = font.widthOfTextAtSize(text, o.fontSize)
    const textH = font.heightAtSize(o.fontSize, { descender: false })
    const rad = (o.angle * Math.PI) / 180
    for (const i of indices) {
      const page = doc.getPage(i)
      const frame = displayFrame(page)
      const centers: [number, number][] = []
      if (o.layout === 'center') {
        centers.push([frame.width / 2, frame.height / 2])
      } else {
        const stepX = textW * Math.abs(Math.cos(rad)) + o.fontSize * 3
        const stepY = Math.max(textH * 4, textW * Math.abs(Math.sin(rad)) + o.fontSize * 2)
        for (let y = stepY / 2; y < frame.height + stepY; y += stepY)
          for (let x = stepX / 2 - ((y / stepY) % 2) * (stepX / 2); x < frame.width + stepX; x += stepX) centers.push([x, y])
      }
      for (const [cx, cy] of centers) {
        // Start the baseline so the text's centre lands on (cx, cy) after rotation.
        const sx = cx - (Math.cos(rad) * textW) / 2 + (Math.sin(rad) * textH) / 2
        const sy = cy - (Math.sin(rad) * textW) / 2 - (Math.cos(rad) * textH) / 2
        const [px, py] = frame.toPdf(sx, sy)
        page.drawText(text, {
          x: px,
          y: py,
          size: o.fontSize,
          font,
          color: rgb(r, g, b),
          opacity: o.opacity,
          rotate: degrees(o.angle + frame.rotation)
        })
      }
    }
  })
}

/* ---------------- Page numbers / header & footer ---------------- */

export interface PageNumberOptions {
  /** Tokens: {n} page number, {total} page count. */
  format: string
  position: 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'
  fontSize: number
  margin: number
  color: string
  startAt: number
  pages: number[] | 'all'
}

export function addPageNumbers(bytes: Uint8Array, o: PageNumberOptions): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const [r, g, b] = hexToRgb(o.color)
    const indices = o.pages === 'all' ? doc.getPageIndices() : o.pages
    const total = indices.length + o.startAt - 1
    indices.forEach((i, k) => {
      const page = doc.getPage(i)
      const frame = displayFrame(page)
      const label = winAnsiSafe(font, o.format.replaceAll('{n}', String(k + o.startAt)).replaceAll('{total}', String(total)))
      const w = font.widthOfTextAtSize(label, o.fontSize)
      const [v, h] = o.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
      const x = h === 'left' ? o.margin : h === 'right' ? frame.width - o.margin - w : (frame.width - w) / 2
      const y = v === 'bottom' ? o.margin : frame.height - o.margin - o.fontSize
      const [px, py] = frame.toPdf(x, y)
      page.drawText(label, { x: px, y: py, size: o.fontSize, font, color: rgb(r, g, b), rotate: degrees(frame.rotation) })
    })
  })
}

/* ---------------- Metadata ---------------- */

export interface DocInfo {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
}

export function setInfo(bytes: Uint8Array, info: Partial<DocInfo>): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    if (info.title !== undefined) doc.setTitle(info.title, { showInWindowTitleBar: true })
    if (info.author !== undefined) doc.setAuthor(info.author)
    if (info.subject !== undefined) doc.setSubject(info.subject)
    if (info.keywords !== undefined) doc.setKeywords(info.keywords.split(/[,;]\s*/).filter(Boolean))
    if (info.creator !== undefined) doc.setCreator(info.creator)
    doc.setModificationDate(new Date())
  })
}

export interface FontInfo {
  name: string
  type: string
  embedded: boolean
}

/** Lists fonts used by page resources (one level of form XObjects deep). */
export async function listFonts(bytes: Uint8Array): Promise<FontInfo[]> {
  const doc = await openLib(bytes)
  const found = new Map<string, FontInfo>()
  const ctx = doc.context
  const visitFonts = (resources: PDFDict | undefined, depth: number): void => {
    if (!resources) return
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict)
    fonts?.entries().forEach(([, ref]) => {
      const font = ctx.lookup(ref)
      if (!(font instanceof PDFDict)) return
      const base = font.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText() ?? '(unnamed)'
      const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '?'
      let descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
      const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)
      if (!descriptor && descendants) {
        const d = descendants.lookup(0)
        if (d instanceof PDFDict) descriptor = d.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
      }
      const embedded =
        subtype === 'Type3' ||
        !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor!.has(PDFName.of(k)))
      const name = base.replace(/^[A-Z]{6}\+/, '')
      if (!found.has(name + subtype)) found.set(name + subtype, { name, type: subtype, embedded })
    })
    if (depth > 1) return
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    xobjects?.entries().forEach(([, ref]) => {
      const xo = ctx.lookup(ref)
      if (xo instanceof PDFStream) visitFonts(xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), depth + 1)
    })
  }
  for (const page of doc.getPages()) visitFonts(page.node.Resources(), 0)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/* ---------------- Native annotations ---------------- */

/** Removes an existing annotation by its object number (pdf.js ids look like "12R"). */
export function deleteNativeAnnotation(bytes: Uint8Array, pageIndex: number, pdfjsId: string): Promise<Uint8Array> {
  const m = /^(\d+)R(\d*)$/.exec(pdfjsId)
  if (!m) return Promise.reject(new Error('This comment cannot be deleted.'))
  const num = parseInt(m[1], 10)
  return edit(bytes, (doc) => {
    const page = doc.getPage(pageIndex)
    const annots = page.node.Annots()
    if (!annots) return
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i)
      if (ref instanceof PDFRef && ref.objectNumber === num) {
        // Remove its popup too, if it has one.
        const dict = doc.context.lookup(ref)
        const popup = dict instanceof PDFDict ? dict.get(PDFName.of('Popup')) : undefined
        annots.remove(i)
        if (popup instanceof PDFRef) {
          for (let j = annots.size() - 1; j >= 0; j--) {
            const r = annots.get(j)
            if (r instanceof PDFRef && r.objectNumber === popup.objectNumber) annots.remove(j)
          }
        }
      }
    }
  })
}

/** Flattens nothing; simply drops every annotation of the given subtypes. */
export function removeAnnotations(bytes: Uint8Array, subtypes: string[] | 'all-comments'): Promise<Uint8Array> {
  return edit(bytes, (doc) => {
    for (const page of doc.getPages()) {
      const annots = page.node.Annots()
      if (!annots) continue
      for (let i = annots.size() - 1; i >= 0; i--) {
        const d = annots.lookup(i)
        if (!(d instanceof PDFDict)) continue
        const st = d.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? ''
        const drop = subtypes === 'all-comments' ? !['Link', 'Widget'].includes(st) : subtypes.includes(st)
        if (drop) annots.remove(i)
      }
    }
  })
}

/* ---------------- Compress ---------------- */

export async function optimize(bytes: Uint8Array, opts: { stripMetadata: boolean; removeComments: boolean }): Promise<Uint8Array> {
  let work = bytes
  if (opts.removeComments) work = await removeAnnotations(work, 'all-comments')
  const doc = await openLib(work)
  if (opts.stripMetadata) {
    doc.catalog.delete(PDFName.of('Metadata'))
    doc.catalog.delete(PDFName.of('PieceInfo'))
    for (const p of doc.getPages()) {
      p.node.delete(PDFName.of('PieceInfo'))
      p.node.delete(PDFName.of('Thumb'))
      p.node.delete(PDFName.of('Metadata'))
    }
  }
  return saveLib(doc)
}

/* ---------------- Images ---------------- */

export interface ImageInput {
  name: string
  bytes: Uint8Array
  /** 'png' or 'jpg'; other formats are converted to PNG by the caller. */
  type: 'png' | 'jpg'
}

export async function imagesToPdf(
  images: ImageInput[],
  opts: { pageSize: 'fit' | 'a4' | 'letter'; margin: number }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const sizes = { a4: [595.28, 841.89], letter: [612, 792] } as const
  for (const img of images) {
    const embedded = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes)
    // Treat images as 96 dpi, so a 1920px screenshot becomes a sensible page.
    const iw = (embedded.width * 72) / 96
    const ih = (embedded.height * 72) / 96
    if (opts.pageSize === 'fit') {
      const page = doc.addPage([iw + opts.margin * 2, ih + opts.margin * 2])
      page.drawImage(embedded, { x: opts.margin, y: opts.margin, width: iw, height: ih })
    } else {
      let [pw, ph]: number[] = [...sizes[opts.pageSize]]
      if (iw > ih) [pw, ph] = [ph, pw]
      const page = doc.addPage([pw, ph])
      const s = Math.min((pw - opts.margin * 2) / iw, (ph - opts.margin * 2) / ih, 1)
      const w = iw * s
      const h = ih * s
      page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
    }
  }
  return saveLib(doc)
}

/**
 * Replaces pages with flat images of themselves. Used by redaction (the
 * original content is gone, not hidden) and by "compress as images".
 */
export async function replacePagesWithImages(
  bytes: Uint8Array,
  images: Map<number, { bytes: Uint8Array; type: 'png' | 'jpg' }>
): Promise<Uint8Array> {
  const doc = await openLib(bytes)
  for (const [index, img] of images) {
    const old = doc.getPage(index)
    const box = old.getCropBox()
    const rotation = old.getRotation().angle
    const embedded = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes)
    const page = doc.insertPage(index, [box.width, box.height])
    page.drawImage(embedded, { x: 0, y: 0, width: box.width, height: box.height })
    page.setRotation(degrees(rotation))
    doc.removePage(index + 1)
  }
  return saveLib(doc)
}

/* ---------------- OCR text layer ---------------- */

export interface PlacedWord {
  text: string
  /** Baseline start in PDF space. */
  x: number
  y: number
  /** Word width along the baseline and font size, in points. */
  width: number
  size: number
  /** Text direction in degrees (page rotation, so words read upright). */
  angle: number
}

/** Adds invisible, selectable text over a scanned page. */
export function addInvisibleText(bytes: Uint8Array, pages: Map<number, PlacedWord[]>): Promise<Uint8Array> {
  return edit(bytes, async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const [index, words] of pages) {
      if (words.length === 0) continue
      const page = doc.getPage(index)
      const key = page.node.newFontDictionary('OcrF', font.ref)
      const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)]
      for (const w of words) {
        const text = winAnsiSafe(font, w.text)
        const natural = font.widthOfTextAtSize(text, w.size)
        if (natural <= 0) continue
        const rad = (w.angle * Math.PI) / 180
        ops.push(setFontAndSize(key, w.size))
        ops.push(PDFOperator.of('Tz' as never, [PDFNumber.of(Math.max(10, Math.min(500, (100 * w.width) / natural)))]))
        ops.push(setTextMatrix(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), w.x, w.y))
        ops.push(showText(font.encodeText(text)))
      }
      ops.push(endText(), popGraphicsState())
      page.pushOperators(...ops)
    }
  })
}
