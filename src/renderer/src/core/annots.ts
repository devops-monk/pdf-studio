/**
 * Writes pending annotations into the PDF as standard annotation objects,
 * each with an appearance stream so every viewer draws them identically.
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts, type PDFFont } from '@cantoo/pdf-lib'
import { openLib, saveLib, winAnsiSafe } from './ops'
import { annotBounds, hexToRgb, type Annot, type Rect } from './types'

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString()

/**
 * The frame in which "upright on screen" content is drawn inside `rect` for a
 * page whose /Rotate is `rotation`. Returns the local width/height and the
 * matrix mapping local coordinates (origin bottom-left, y up) to PDF space.
 */
export function localFrame(rect: Rect, rotation: number): { w: number; h: number; m: [number, number, number, number, number, number] } {
  const [x1, y1, x2, y2] = rect
  const w = x2 - x1
  const h = y2 - y1
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { w: h, h: w, m: [0, 1, -1, 0, x2, y1] }
    case 180:
      return { w, h, m: [-1, 0, 0, -1, x2, y2] }
    case 270:
      return { w: h, h: w, m: [0, -1, 1, 0, x1, y2] }
    default:
      return { w, h, m: [1, 0, 0, 1, x1, y1] }
  }
}

/** Greedy word wrap using the given width measure. Keeps explicit line breaks. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (measure(next.trimEnd()) <= maxWidth || !line.trim()) {
        line = next
      } else {
        lines.push(line.trimEnd())
        line = word.trimStart()
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export const STAMP_PRESETS = [
  { label: 'APPROVED', color: '#2f7d4f' },
  { label: 'REVIEWED', color: '#2a62b8' },
  { label: 'DRAFT', color: '#6b7480' },
  { label: 'CONFIDENTIAL', color: '#c63b2f' },
  { label: 'FINAL', color: '#2f7d4f' },
  { label: 'NOT APPROVED', color: '#c63b2f' },
  { label: 'FOR COMMENT', color: '#a76a00' },
  { label: 'VOID', color: '#c63b2f' }
] as const

function ellipsePath(x: number, y: number, w: number, h: number): string {
  const k = 0.5522847498
  const rx = w / 2
  const ry = h / 2
  const cx = x + rx
  const cy = y + ry
  return [
    `${f(cx + rx)} ${f(cy)} m`,
    `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
    `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c`,
    `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
    `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c`
  ].join('\n')
}

/** Arrow head as two short strokes at `to`, pointing away from `from`. */
export function arrowHead(from: [number, number], to: [number, number], size: number): [[number, number], [number, number]] {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0])
  const spread = Math.PI / 7
  return [
    [to[0] - size * Math.cos(ang - spread), to[1] - size * Math.sin(ang - spread)],
    [to[0] - size * Math.cos(ang + spread), to[1] - size * Math.sin(ang + spread)]
  ]
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

async function writeOne(doc: PDFDocument, a: Annot, fonts: Fonts): Promise<void> {
  const ctx = doc.context
  const page = doc.getPage(a.page)
  const [r, g, b] = hexToRgb(a.color)
  const rgbStr = `${f(r)} ${f(g)} ${f(b)}`
  const gs = (bm?: string): PDFDict =>
    ctx.obj({ GS0: ctx.obj({ Type: 'ExtGState', CA: a.opacity, ca: a.opacity, ...(bm ? { BM: bm } : {}) }) }) as PDFDict

  let rect: Rect = annotBounds(a)
  let content = ''
  const resources: Record<string, unknown> = {}
  const dict: Record<string, unknown> = {
    Type: 'Annot',
    F: 4, // Print
    C: [r, g, b],
    CA: a.opacity,
    M: PDFString.fromDate(new Date(a.createdAt)),
    NM: PDFHexString.fromText(`pdfstudio-${a.id}`)
  }
  const pad = (n: number): Rect => [rect[0] - n, rect[1] - n, rect[2] + n, rect[3] + n]

  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strike': {
      const quads = a.quads ?? []
      dict.Subtype = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut' }[a.kind]
      dict.QuadPoints = quads.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1])
      resources.ExtGState = gs(a.kind === 'highlight' ? 'Multiply' : undefined)
      content = '/GS0 gs\n'
      if (a.kind === 'highlight') {
        content += `${rgbStr} rg\n` + quads.map(([x1, y1, x2, y2]) => `${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re f`).join('\n')
      } else {
        content += `${rgbStr} RG\n`
        for (const [x1, y1, x2, y2] of quads) {
          const h = y2 - y1
          const y = a.kind === 'underline' ? y1 + h * 0.08 : y1 + h * 0.45
          content += `${f(Math.max(0.8, h * 0.07))} w ${f(x1)} ${f(y)} m ${f(x2)} ${f(y)} l S\n`
        }
      }
      break
    }
    case 'rect':
    case 'ellipse': {
      const [x1, y1, x2, y2] = a.rect!
      const half = a.width / 2
      dict.Subtype = a.kind === 'rect' ? 'Square' : 'Circle'
      dict.BS = { W: a.width, S: 'S' }
      if (a.fill) dict.IC = hexToRgb(a.fill)
      resources.ExtGState = gs()
      const fill = a.fill ? `${hexToRgb(a.fill).map(f).join(' ')} rg\n` : ''
      const op = a.fill ? 'B' : 'S'
      const shape =
        a.kind === 'rect'
          ? `${f(x1 + half)} ${f(y1 + half)} ${f(x2 - x1 - a.width)} ${f(y2 - y1 - a.width)} re ${op}`
          : `${ellipsePath(x1 + half, y1 + half, x2 - x1 - a.width, y2 - y1 - a.width)} ${op}`
      content = `/GS0 gs ${rgbStr} RG ${fill}${f(a.width)} w 1 j\n${shape}`
      break
    }
    case 'line':
    case 'arrow': {
      const from = a.from!
      const to = a.to!
      const head = Math.max(8, a.width * 4)
      dict.Subtype = 'Line'
      dict.L = [from[0], from[1], to[0], to[1]]
      dict.BS = { W: a.width }
      dict.LE = ['None', a.kind === 'arrow' ? 'OpenArrow' : 'None']
      rect = pad(head + a.width)
      resources.ExtGState = gs()
      content = `/GS0 gs ${rgbStr} RG ${f(a.width)} w 1 J 1 j\n${f(from[0])} ${f(from[1])} m ${f(to[0])} ${f(to[1])} l S`
      if (a.kind === 'arrow') {
        const [p1, p2] = arrowHead(from, to, head)
        content += `\n${f(p1[0])} ${f(p1[1])} m ${f(to[0])} ${f(to[1])} l ${f(p2[0])} ${f(p2[1])} l S`
      }
      break
    }
    case 'ink': {
      const paths = a.paths ?? []
      dict.Subtype = 'Ink'
      dict.InkList = paths.map((p) => p.flat())
      dict.BS = { W: a.width }
      rect = pad(a.width)
      resources.ExtGState = gs()
      content =
        `/GS0 gs ${rgbStr} RG ${f(a.width)} w 1 J 1 j\n` +
        paths
          .map((p) => p.map(([x, y], i) => `${f(x)} ${f(y)} ${i === 0 ? 'm' : 'l'}`).join(' ') + (p.length === 1 ? ` ${f(p[0][0] + 0.01)} ${f(p[0][1])} l` : '') + ' S')
          .join('\n')
      break
    }
    case 'note': {
      dict.Subtype = 'Text'
      dict.Name = 'Comment'
      dict.Open = false
      dict.Contents = PDFHexString.fromText(a.text ?? '')
      const fr = localFrame(rect, a.rotation)
      const s = Math.min(fr.w, fr.h)
      resources.ExtGState = gs()
      content =
        `/GS0 gs q ${fr.m.map(f).join(' ')} cm\n` +
        `${rgbStr} rg 0.15 0.15 0.15 RG 0.6 w\n` +
        `${f(s * 0.08)} ${f(s * 0.25)} ${f(s * 0.84)} ${f(s * 0.67)} re B\n` +
        `${f(s * 0.25)} ${f(s * 0.25)} m ${f(s * 0.2)} ${f(s * 0.06)} l ${f(s * 0.45)} ${f(s * 0.25)} l f\n` +
        `0.15 0.15 0.15 RG ${f(s * 0.05)} w\n` +
        [0.72, 0.56, 0.4].map((y) => `${f(s * 0.22)} ${f(s * y)} m ${f(s * 0.78)} ${f(s * y)} l S`).join('\n') +
        '\nQ'
      break
    }
    case 'text': {
      const size = a.fontSize ?? 14
      const text = winAnsiSafe(fonts.regular, a.text ?? '')
      dict.Subtype = 'FreeText'
      dict.Contents = PDFHexString.fromText(a.text ?? '')
      dict.DA = PDFString.of(`/Helv ${f(size)} Tf ${rgbStr} rg`)
      dict.BS = { W: 0 }
      if (a.rotation) dict.Rotate = a.rotation
      resources.Font = ctx.obj({ Helv: fonts.regular.ref })
      resources.ExtGState = gs()
      const fr = localFrame(rect, a.rotation)
      const lines = wrapLines(text, fr.w - 4, (s) => fonts.regular.widthOfTextAtSize(s, size))
      const lead = size * 1.2
      let body = `/GS0 gs q ${fr.m.map(f).join(' ')} cm\n`
      if (a.fill) body += `${hexToRgb(a.fill).map(f).join(' ')} rg 0 0 ${f(fr.w)} ${f(fr.h)} re f\n`
      body += `BT /Helv ${f(size)} Tf ${rgbStr} rg\n`
      lines.forEach((line, i) => {
        const y = fr.h - 2 - size * 0.93 - i * lead
        body += `1 0 0 1 2 ${f(y)} Tm ${fonts.regular.encodeText(line).toString()} Tj\n`
      })
      content = body + 'ET Q'
      break
    }
    case 'stamp': {
      const label = winAnsiSafe(fonts.bold, (a.text ?? 'APPROVED').toUpperCase())
      dict.Subtype = 'Stamp'
      dict.Name = PDFName.of(label.replace(/[^A-Za-z]/g, '') || 'Stamp')
      dict.Contents = PDFHexString.fromText(a.text ?? '')
      if (a.rotation) dict.Rotate = a.rotation
      resources.Font = ctx.obj({ HelvB: fonts.bold.ref })
      resources.ExtGState = gs()
      const fr = localFrame(rect, a.rotation)
      const border = Math.max(1.5, fr.h * 0.07)
      const natural = fonts.bold.widthOfTextAtSize(label, 10)
      const size = Math.min((fr.h - border * 4) * 0.72, ((fr.w - border * 6) / natural) * 10)
      const tw = fonts.bold.widthOfTextAtSize(label, size)
      const rr = Math.min(fr.h * 0.18, 8)
      const x0 = border / 2
      const y0 = border / 2
      const w = fr.w - border
      const h = fr.h - border
      const k = 0.5523 * rr
      const round =
        `${f(x0 + rr)} ${f(y0)} m ${f(x0 + w - rr)} ${f(y0)} l ${f(x0 + w - rr + k)} ${f(y0)} ${f(x0 + w)} ${f(y0 + rr - k)} ${f(x0 + w)} ${f(y0 + rr)} c ` +
        `${f(x0 + w)} ${f(y0 + h - rr)} l ${f(x0 + w)} ${f(y0 + h - rr + k)} ${f(x0 + w - rr + k)} ${f(y0 + h)} ${f(x0 + w - rr)} ${f(y0 + h)} c ` +
        `${f(x0 + rr)} ${f(y0 + h)} l ${f(x0 + rr - k)} ${f(y0 + h)} ${f(x0)} ${f(y0 + h - rr + k)} ${f(x0)} ${f(y0 + h - rr)} c ` +
        `${f(x0)} ${f(y0 + rr)} l ${f(x0)} ${f(y0 + rr - k)} ${f(x0 + rr - k)} ${f(y0)} ${f(x0 + rr)} ${f(y0)} c h`
      content =
        `/GS0 gs q ${fr.m.map(f).join(' ')} cm\n${rgbStr} RG ${rgbStr} rg ${f(border)} w\n${round} S\n` +
        `BT /HelvB ${f(size)} Tf 1 0 0 1 ${f((fr.w - tw) / 2)} ${f((fr.h - size * 0.7) / 2)} Tm ${fonts.bold.encodeText(label).toString()} Tj ET Q`
      break
    }
    case 'image': {
      const img = await doc.embedPng(dataUrlBytes(a.image!))
      dict.Subtype = 'Stamp'
      dict.Name = PDFName.of(a.signature ? 'Signature' : 'Image')
      if (a.signature) dict.Contents = PDFHexString.fromText('Signature')
      if (a.rotation) dict.Rotate = a.rotation
      resources.XObject = ctx.obj({ Im0: img.ref })
      resources.ExtGState = gs()
      const fr = localFrame(rect, a.rotation)
      content = `/GS0 gs q ${fr.m.map(f).join(' ')} cm ${f(fr.w)} 0 0 ${f(fr.h)} 0 0 cm /Im0 Do Q`
      break
    }
    case 'redact':
      return
  }

  dict.Rect = rect
  dict.P = page.ref
  const ap = ctx.flateStream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: ctx.obj(resources as never)
  })
  dict.AP = ctx.obj({ N: ctx.register(ap) })
  const ref: PDFRef = ctx.register(ctx.obj(dict as never))
  page.node.addAnnot(ref)
}

/** Writes every non-redaction annotation into a copy of the document. */
export async function writeAnnotations(bytes: Uint8Array, annots: Annot[]): Promise<Uint8Array> {
  const real = annots.filter((a) => a.kind !== 'redact')
  if (real.length === 0) return bytes
  const doc = await openLib(bytes)
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  }
  for (const a of real) {
    if (a.page < doc.getPageCount()) await writeOne(doc, a, fonts)
  }
  return saveLib(doc)
}
