/** A point in PDF user space (points, origin bottom-left of the page box). */
export type Pt = [number, number]
/** A rectangle in PDF user space, normalised so x1 < x2 and y1 < y2. */
export type Rect = [number, number, number, number]

export type AnnotKind =
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'note'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'stamp'
  | 'image'
  | 'redact'

/**
 * An annotation the user is still editing. It lives on top of the page until
 * the document is saved (or a page operation commits it), when it is written
 * as a real PDF annotation with its own appearance.
 */
export interface Annot {
  id: string
  page: number
  kind: AnnotKind
  color: string
  opacity: number
  /** Stroke width in points. */
  width: number
  /** Display rotation of the page when created, so text and images stay upright. */
  rotation: number
  createdAt: number
  rect?: Rect
  quads?: Rect[]
  from?: Pt
  to?: Pt
  paths?: Pt[][]
  /** Note body, text-box text or stamp label. */
  text?: string
  fontSize?: number
  fill?: string | null
  /** PNG data URL for images and signatures. */
  image?: string
  /** True for signatures, so the UI can name them. */
  signature?: boolean
}

export function normRect(a: Pt, b: Pt): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

export function annotBounds(a: Annot): Rect {
  if (a.rect) return a.rect
  if (a.quads?.length) {
    return a.quads.reduce<Rect>(
      (r, q) => [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[2]), Math.max(r[3], q[3])],
      [...a.quads[0]] as Rect
    )
  }
  if (a.from && a.to) return normRect(a.from, a.to)
  if (a.paths?.length) {
    const pts = a.paths.flat()
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  return [0, 0, 0, 0]
}

export function translateAnnot(a: Annot, dx: number, dy: number): Annot {
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy]
  const mr = (r: Rect): Rect => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]
  return {
    ...a,
    rect: a.rect && mr(a.rect),
    quads: a.quads?.map(mr),
    from: a.from && mv(a.from),
    to: a.to && mv(a.to),
    paths: a.paths?.map((path) => path.map(mv))
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
