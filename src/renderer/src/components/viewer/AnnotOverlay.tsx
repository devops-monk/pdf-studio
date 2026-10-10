import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PageViewport } from '@/core/pdf'
import { arrowHead, localFrame } from '@/core/annots'
import { annotBounds, normRect, translateAnnot, uid, type Annot, type AnnotKind, type Pt, type Rect } from '@/core/types'
import { useDocs } from '@/store/docs'
import { useUi, type Tool } from '@/store/ui'
import { toast } from '../ui'

const MARKUP: Tool[] = ['highlight', 'underline', 'strike']
const DRAW: Tool[] = ['note', 'text', 'rect', 'ellipse', 'line', 'arrow', 'ink', 'stamp', 'image', 'redact']
const RESIZABLE: AnnotKind[] = ['rect', 'ellipse', 'text', 'stamp', 'image', 'redact']
const ONE_SHOT: Tool[] = ['note', 'text', 'stamp', 'image']

type Drag =
  | { kind: 'create'; start: Pt }
  | { kind: 'ink'; points: Pt[] }
  | { kind: 'move'; id: string; start: Pt; orig: Annot; moved: boolean }
  | { kind: 'resize'; id: string; corner: number; orig: Annot; moved: boolean }
  | { kind: 'endpoint'; id: string; which: 'from' | 'to'; orig: Annot; moved: boolean }

interface Props {
  docId: string
  index: number
  viewport: PageViewport
  pageRotation: number
}

/** Merges per-glyph client rects into one rect per line run. */
function mergeLineRects(rects: DOMRect[]): DOMRect[] {
  const sorted = rects.filter((r) => r.width > 0.5 && r.height > 0.5).sort((a, b) => a.top - b.top || a.left - b.left)
  const out: DOMRect[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    if (last && Math.abs(last.top - r.top) < last.height * 0.5 && Math.abs(last.bottom - r.bottom) < last.height * 0.5 && r.left - last.right < last.height) {
      const left = Math.min(last.left, r.left)
      const top = Math.min(last.top, r.top)
      out[out.length - 1] = new DOMRect(left, top, Math.max(last.right, r.right) - left, Math.max(last.bottom, r.bottom) - top)
    } else {
      out.push(r)
    }
  }
  return out
}

export function AnnotOverlay({ docId, index, viewport, pageRotation }: Props): ReactNode {
  const svgRef = useRef<SVGSVGElement>(null)
  const allAnnots = useDocs((s) => s.get(docId)?.annots)
  const annots = useMemo(() => (allAnnots ?? []).filter((a) => a.page === index), [allAnnots, index])
  const tool = useUi((s) => s.tool)
  const style = useUi((s) => s.style)
  const selected = useUi((s) => s.selectedAnnot)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<Annot | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag

  const scale = viewport.scale
  const transform = `matrix(${viewport.transform.join(' ')})`

  const store = useDocs.getState
  const current = (): Annot[] => store().get(docId)?.annots ?? []
  const commit = (next: Annot[], label: string): void => store().setAnnots(docId, next, label)

  const toPdf = (clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    const [x, y] = viewport.convertToPdfPoint(clientX - r.left, clientY - r.top)
    return [x, y]
  }

  const base = (kind: AnnotKind): Annot => ({
    id: uid(),
    page: index,
    kind,
    color: kind === 'redact' ? '#000000' : style.color,
    opacity: kind === 'highlight' ? Math.min(style.opacity, 1) : style.opacity,
    width: style.width,
    rotation: pageRotation,
    createdAt: Date.now()
  })

  // Text markup from a text selection that ends on this page.
  useEffect(() => {
    if (!MARKUP.includes(tool)) return
    const onUp = (): void => {
      const sel = window.getSelection()
      const svg = svgRef.current
      if (!sel || sel.isCollapsed || !svg) return
      const box = svg.getBoundingClientRect()
      const rects: DOMRect[] = []
      for (let i = 0; i < sel.rangeCount; i++) {
        for (const r of Array.from(sel.getRangeAt(i).getClientRects())) {
          const cx = r.left + r.width / 2
          const cy = r.top + r.height / 2
          const inside = cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom
          const huge = r.height > box.height * 0.3
          if (inside && !huge) rects.push(r)
        }
      }
      if (!rects.length) return
      const quads: Rect[] = mergeLineRects(rects).map((r) => normRect(toPdf(r.left, r.top), toPdf(r.right, r.bottom)))
      const a: Annot = { ...base(tool as AnnotKind), quads, text: sel.toString() }
      commit([...current(), a], { highlight: 'Highlight', underline: 'Underline', strike: 'Strike through' }[tool as 'highlight'])
      setTimeout(() => window.getSelection()?.removeAllRanges(), 0)
    }
    document.addEventListener('pointerup', onUp)
    return () => document.removeEventListener('pointerup', onUp)
  }) // re-bound each render so it sees the current viewport and style

  const draftFor = (d: Drag, p: Pt): Annot | null => {
    if (d.kind === 'ink') return { ...base('ink'), paths: [d.points] }
    if (d.kind !== 'create') return null
    const k = tool as AnnotKind
    if (k === 'line' || k === 'arrow') return { ...base(k), from: d.start, to: p }
    if (k === 'note') return null
    const rect = normRect(d.start, p)
    if (k === 'image' && style.pendingImage) {
      // Keep the image's aspect ratio while dragging.
      const ratio = style.pendingImage.height / style.pendingImage.width
      const w = rect[2] - rect[0]
      const portrait = pageRotation % 180 !== 0
      const h = portrait ? w / ratio : w * ratio
      const y2 = d.start[1] >= p[1] ? d.start[1] : d.start[1] + h
      return { ...base('image'), rect: [rect[0], y2 - h, rect[2], y2], image: style.pendingImage.dataUrl, signature: style.pendingImage.signature }
    }
    return {
      ...base(k),
      rect,
      fill: k === 'rect' || k === 'ellipse' || k === 'text' ? style.fill : undefined,
      fontSize: style.fontSize,
      text: k === 'stamp' ? style.stampLabel : ''
    }
  }

  const defaultSized = (p: Pt): Annot | null => {
    const k = tool as AnnotKind
    const portrait = pageRotation % 180 !== 0
    const box = (w: number, h: number): Rect => {
      const [ww, hh] = portrait ? [h, w] : [w, h]
      return [p[0], p[1] - hh, p[0] + ww, p[1]]
    }
    switch (k) {
      case 'note':
        return { ...base('note'), rect: [p[0], p[1] - 22, p[0] + 22, p[1]], text: '' }
      case 'text':
        return {
          ...base('text'),
          rect: box(style.pendingText ? Math.max(60, style.pendingText.length * style.fontSize * 0.6 + 12) : 220, style.fontSize * 1.9),
          fontSize: style.fontSize,
          fill: style.fill,
          text: style.pendingText
        }
      case 'stamp':
        return { ...base('stamp'), rect: box(Math.max(110, style.stampLabel.length * 13 + 30), 44), text: style.stampLabel }
      case 'image': {
        const img = style.pendingImage
        if (!img) return null
        const w = img.signature ? 170 : 220
        return { ...base('image'), rect: box(w, (w * img.height) / img.width), image: img.dataUrl, signature: img.signature }
      }
      case 'rect':
      case 'ellipse':
      case 'redact':
        return { ...base(k), rect: box(120, 70), fill: k === 'redact' ? undefined : style.fill }
      case 'line':
      case 'arrow':
        return { ...base(k), from: p, to: [p[0] + 100, p[1]] }
      default:
        return null
    }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !DRAW.includes(tool)) return
    if (tool === 'image' && !style.pendingImage) {
      toast.info('Choose an image or signature first.')
      return
    }
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toPdf(e.clientX, e.clientY)
    useUi.getState().set({ selectedAnnot: null })
    setEditing(null)
    setDrag(tool === 'ink' ? { kind: 'ink', points: [p] } : { kind: 'create', start: p })
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const p = toPdf(e.clientX, e.clientY)
    if (d.kind === 'ink') {
      const last = d.points.at(-1)!
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * scale < 1.5) return
      const next = { kind: 'ink' as const, points: [...d.points, p] }
      setDrag(next)
      setDraft(draftFor(next, p))
    } else if (d.kind === 'create') {
      setDraft(draftFor(d, p))
    } else if (d.kind === 'move') {
      if (!d.moved) store().checkpoint(docId, 'Move comment')
      const moved = translateAnnot(d.orig, p[0] - d.start[0], p[1] - d.start[1])
      setDrag({ ...d, moved: true })
      store().setAnnotsLive(docId, current().map((a) => (a.id === d.id ? moved : a)))
    } else if (d.kind === 'resize') {
      if (!d.moved) store().checkpoint(docId, 'Resize comment')
      const [x1, y1, x2, y2] = d.orig.rect!
      const corners: Pt[] = [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2]
      ]
      const opposite = corners[(d.corner + 2) % 4]
      let rect = normRect(opposite, p)
      if (d.orig.kind === 'image') {
        const ratio = (y2 - y1) / (x2 - x1)
        const w = rect[2] - rect[0]
        rect = p[1] < opposite[1] ? [rect[0], opposite[1] - w * ratio, rect[2], opposite[1]] : [rect[0], opposite[1], rect[2], opposite[1] + w * ratio]
      }
      if (rect[2] - rect[0] < 6 || rect[3] - rect[1] < 6) return
      setDrag({ ...d, moved: true })
      store().setAnnotsLive(docId, current().map((a) => (a.id === d.id ? { ...a, rect } : a)))
    } else if (d.kind === 'endpoint') {
      if (!d.moved) store().checkpoint(docId, 'Edit line')
      setDrag({ ...d, moved: true })
      store().setAnnotsLive(docId, current().map((a) => (a.id === d.id ? { ...a, [d.which]: p } : a)))
    }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = dragRef.current
    setDrag(null)
    if (!d) return
    const p = toPdf(e.clientX, e.clientY)
    if (d.kind === 'ink') {
      setDraft(null)
      if (d.points.length > 0) commit([...current(), { ...base('ink'), paths: [d.points] }], 'Draw')
      return
    }
    if (d.kind !== 'create') return
    const tiny = Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) * scale < 6
    const made = tiny ? defaultSized(d.start) : draftFor(d, p)
    setDraft(null)
    if (!made) return
    const label: Record<string, string> = {
      note: 'Add note',
      text: 'Add text box',
      rect: 'Draw rectangle',
      ellipse: 'Draw ellipse',
      line: 'Draw line',
      arrow: 'Draw arrow',
      stamp: 'Add stamp',
      image: made.signature ? 'Add signature' : 'Add image',
      redact: 'Mark for redaction'
    }
    commit([...current(), made], label[made.kind] ?? 'Add comment')
    useUi.getState().set({ selectedAnnot: made.id })
    if ((made.kind === 'text' && !made.text) || made.kind === 'note') setEditing(made.id)
    if (style.pendingText) useUi.getState().setStyle({ pendingText: '' })
    if (ONE_SHOT.includes(tool)) useUi.getState().setTool('select')
  }

  const startMove = (e: React.PointerEvent, a: Annot): void => {
    if (tool !== 'select' || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    ;(svgRef.current as Element).setPointerCapture(e.pointerId)
    useUi.getState().set({ selectedAnnot: a.id })
    if (editing !== a.id) setEditing(null)
    setDrag({ kind: 'move', id: a.id, start: toPdf(e.clientX, e.clientY), orig: a, moved: false })
  }

  const startResize = (e: React.PointerEvent, a: Annot, corner: number): void => {
    e.stopPropagation()
    e.preventDefault()
    ;(svgRef.current as Element).setPointerCapture(e.pointerId)
    setDrag({ kind: 'resize', id: a.id, corner, orig: a, moved: false })
  }

  const startEndpoint = (e: React.PointerEvent, a: Annot, which: 'from' | 'to'): void => {
    e.stopPropagation()
    e.preventDefault()
    ;(svgRef.current as Element).setPointerCapture(e.pointerId)
    setDrag({ kind: 'endpoint', id: a.id, which, orig: a, moved: false })
  }

  const setText = (id: string, text: string): void => {
    const a = current().find((x) => x.id === id)
    if (!a || a.text === text) return
    if (!text.trim() && a.kind === 'text') {
      commit(current().filter((x) => x.id !== id), 'Delete text box')
      return
    }
    commit(current().map((x) => (x.id === id ? { ...x, text } : x)), 'Edit text')
  }

  const active = DRAW.includes(tool)
  const handle = 5 / scale
  const sel = annots.find((a) => a.id === selected)
  const noteEditor = sel?.kind === 'note' ? sel : null

  const shape = (a: Annot): ReactNode => (
    <AnnotShape
      key={a.id}
      a={a}
      scale={scale}
      index={index}
      selected={a.id === selected}
      editing={a.id === editing}
      onPointerDown={(e) => startMove(e, a)}
      onDoubleClick={() => (a.kind === 'text' || a.kind === 'note') && setEditing(a.id)}
      onText={(t) => {
        setText(a.id, t)
        setEditing(null)
      }}
    />
  )

  return (
    <>
      {/* Highlights sit in their own layer so they multiply with the page like a real marker. */}
      <svg className={`annot-marks${tool === 'select' ? ' selecting' : ''}`} width={viewport.width} height={viewport.height} aria-hidden>
        <g transform={transform}>
          {annots.filter((a) => a.kind === 'highlight').map(shape)}
          {draft?.kind === 'highlight' && <AnnotShape a={draft} scale={scale} index={index} selected={false} editing={false} />}
        </g>
      </svg>
      <svg
        ref={svgRef}
        className={`annot-overlay${active ? ' drawing' : ''}${tool === 'select' ? ' selecting' : ''}`}
        data-tool={tool}
        width={viewport.width}
        height={viewport.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDrag(null)
          setDraft(null)
        }}
      >
        <defs>
          <pattern id={`hatch-${index}`} width={6 / scale} height={6 / scale} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={6 / scale} stroke="#c63b2f" strokeWidth={1.5 / scale} opacity="0.55" />
          </pattern>
        </defs>
        <g transform={transform}>
          {annots.filter((a) => a.kind !== 'highlight').map(shape)}
          {draft && draft.kind !== 'highlight' && <AnnotShape a={draft} scale={scale} index={index} selected={false} editing={false} />}
          {sel && tool === 'select' && (
            <g className="selection">
              {(() => {
                const [x1, y1, x2, y2] = annotBounds(sel)
                const pad = 3 / scale
                return (
                  <rect
                    x={x1 - pad}
                    y={y1 - pad}
                    width={x2 - x1 + pad * 2}
                    height={y2 - y1 + pad * 2}
                    fill="none"
                    stroke="var(--mark-line)"
                    strokeWidth={1.25 / scale}
                    strokeDasharray={`${4 / scale} ${3 / scale}`}
                  />
                )
              })()}
              {RESIZABLE.includes(sel.kind) &&
                sel.rect &&
                (
                  [
                    [sel.rect[0], sel.rect[1]],
                    [sel.rect[2], sel.rect[1]],
                    [sel.rect[2], sel.rect[3]],
                    [sel.rect[0], sel.rect[3]]
                  ] as Pt[]
                ).map((c, i) => (
                  <rect
                    key={i}
                    className="handle"
                    x={c[0] - handle}
                    y={c[1] - handle}
                    width={handle * 2}
                    height={handle * 2}
                    strokeWidth={1.25 / scale}
                    onPointerDown={(e) => startResize(e, sel, i)}
                  />
                ))}
              {(sel.kind === 'line' || sel.kind === 'arrow') &&
                (['from', 'to'] as const).map((w) => (
                  <circle key={w} className="handle" cx={sel[w]![0]} cy={sel[w]![1]} r={handle} strokeWidth={1.25 / scale} onPointerDown={(e) => startEndpoint(e, sel, w)} />
                ))}
            </g>
          )}
        </g>
      </svg>
      {noteEditor && (
        <NoteEditor
          key={noteEditor.id}
          a={noteEditor}
          viewport={viewport}
          autoFocus={editing === noteEditor.id}
          onSave={(t) => setText(noteEditor.id, t)}
          onDelete={() => {
            commit(current().filter((x) => x.id !== noteEditor.id), 'Delete note')
            useUi.getState().set({ selectedAnnot: null })
          }}
          onClose={() => {
            useUi.getState().set({ selectedAnnot: null })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function NoteEditor(props: {
  a: Annot
  viewport: PageViewport
  autoFocus: boolean
  onSave: (text: string) => void
  onDelete: () => void
  onClose: () => void
}): ReactNode {
  const [text, setText] = useState(props.a.text ?? '')
  const [x, y] = props.viewport.convertToViewportPoint(props.a.rect![2], props.a.rect![3])
  const left = Math.min(x + 8, props.viewport.width - 250)
  return (
    <div className="note-editor" style={{ left: Math.max(8, left), top: Math.max(8, y) }} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        className="textarea"
        autoFocus={props.autoFocus}
        placeholder="Write a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => props.onSave(text)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') props.onClose()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            props.onSave(text)
            props.onClose()
          }
        }}
      />
      <div className="row">
        <button className="btn sm ghost" onClick={props.onDelete}>
          Delete
        </button>
        <span className="grow" />
        <button
          className="btn sm primary"
          onClick={() => {
            props.onSave(text)
            props.onClose()
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

function AnnotShape(props: {
  a: Annot
  scale: number
  index: number
  selected: boolean
  editing: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  onDoubleClick?: () => void
  onText?: (text: string) => void
}): ReactNode {
  const { a, scale } = props
  const common = {
    'data-annot': a.id,
    className: 'annot',
    onPointerDown: props.onPointerDown,
    onDoubleClick: props.onDoubleClick
  }
  const hitWidth = Math.max(a.width, 10 / scale)
  const local = (rect: Rect, children: (w: number, h: number) => ReactNode): ReactNode => {
    const fr = localFrame(rect, a.rotation)
    return <g transform={`matrix(${fr.m.join(' ')}) matrix(1 0 0 -1 0 ${fr.h})`}>{children(fr.w, fr.h)}</g>
  }

  switch (a.kind) {
    case 'highlight':
      return (
        <g {...common} opacity={a.opacity}>
          {a.quads!.map((q, i) => (
            <rect key={i} x={q[0]} y={q[1]} width={q[2] - q[0]} height={q[3] - q[1]} fill={a.color} />
          ))}
        </g>
      )
    case 'underline':
    case 'strike':
      return (
        <g {...common} opacity={a.opacity}>
          {a.quads!.map((q, i) => {
            const h = q[3] - q[1]
            const y = a.kind === 'underline' ? q[1] + h * 0.08 : q[1] + h * 0.45
            return (
              <g key={i}>
                <rect x={q[0]} y={q[1]} width={q[2] - q[0]} height={h} fill="transparent" />
                <line x1={q[0]} x2={q[2]} y1={y} y2={y} stroke={a.color} strokeWidth={Math.max(0.8, h * 0.07)} />
              </g>
            )
          })}
        </g>
      )
    case 'rect':
    case 'redact': {
      const [x1, y1, x2, y2] = a.rect!
      const redact = a.kind === 'redact'
      return (
        <rect
          {...common}
          x={x1 + a.width / 2}
          y={y1 + a.width / 2}
          width={Math.max(0, x2 - x1 - a.width)}
          height={Math.max(0, y2 - y1 - a.width)}
          fill={redact ? `url(#hatch-${props.index})` : (a.fill ?? 'transparent')}
          stroke={redact ? '#c63b2f' : a.color}
          strokeWidth={redact ? 1.5 / scale : a.width}
          opacity={redact ? 1 : a.opacity}
        />
      )
    }
    case 'ellipse': {
      const [x1, y1, x2, y2] = a.rect!
      return (
        <ellipse
          {...common}
          cx={(x1 + x2) / 2}
          cy={(y1 + y2) / 2}
          rx={Math.max(0, (x2 - x1 - a.width) / 2)}
          ry={Math.max(0, (y2 - y1 - a.width) / 2)}
          fill={a.fill ?? 'transparent'}
          stroke={a.color}
          strokeWidth={a.width}
          opacity={a.opacity}
        />
      )
    }
    case 'line':
    case 'arrow': {
      const head = a.kind === 'arrow' ? arrowHead(a.from!, a.to!, Math.max(8, a.width * 4)) : null
      return (
        <g {...common} opacity={a.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1={a.from![0]} y1={a.from![1]} x2={a.to![0]} y2={a.to![1]} stroke="transparent" strokeWidth={hitWidth} />
          <line x1={a.from![0]} y1={a.from![1]} x2={a.to![0]} y2={a.to![1]} stroke={a.color} strokeWidth={a.width} />
          {head && <polyline points={`${head[0].join(',')} ${a.to!.join(',')} ${head[1].join(',')}`} stroke={a.color} strokeWidth={a.width} />}
        </g>
      )
    }
    case 'ink':
      return (
        <g {...common} opacity={a.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {a.paths!.map((p, i) => {
            const pts = p.length === 1 ? [...p, [p[0][0] + 0.01, p[0][1]]] : p
            return (
              <g key={i}>
                <polyline points={pts.map((q) => q.join(',')).join(' ')} stroke="transparent" strokeWidth={hitWidth} />
                <polyline points={pts.map((q) => q.join(',')).join(' ')} stroke={a.color} strokeWidth={a.width} />
              </g>
            )
          })}
        </g>
      )
    case 'note':
      return (
        <g {...common} opacity={a.opacity}>
          {local(a.rect!, (w, h) => {
            const s = Math.min(w, h)
            return (
              <g>
                <rect x={s * 0.08} y={s * 0.08} width={s * 0.84} height={s * 0.67} rx={s * 0.08} fill={a.color} stroke="#262626" strokeWidth={0.6} />
                <path d={`M${s * 0.25} ${s * 0.74} L${s * 0.2} ${s * 0.94} L${s * 0.45} ${s * 0.74} Z`} fill={a.color} stroke="#262626" strokeWidth={0.6} />
                {[0.28, 0.44, 0.6].map((y) => (
                  <line key={y} x1={s * 0.22} x2={s * 0.78} y1={s * y} y2={s * y} stroke="#262626" strokeWidth={s * 0.05} />
                ))}
              </g>
            )
          })}
        </g>
      )
    case 'text':
      return (
        <g {...common} opacity={a.opacity}>
          {local(a.rect!, (w, h) => (
            <foreignObject x={0} y={0} width={w} height={h} style={{ overflow: 'visible' }}>
              <TextBox a={a} editing={props.editing} selected={props.selected} onText={props.onText} />
            </foreignObject>
          ))}
        </g>
      )
    case 'stamp':
      return (
        <g {...common} opacity={a.opacity}>
          {local(a.rect!, (w, h) => {
            const b = Math.max(1.5, h * 0.07)
            return (
              <g>
                <rect x={b / 2} y={b / 2} width={w - b} height={h - b} rx={Math.min(h * 0.18, 8)} fill="rgba(255,255,255,0.01)" stroke={a.color} strokeWidth={b} />
                <text
                  x={w / 2}
                  y={h / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fill={a.color}
                  fontFamily="Helvetica, Arial, sans-serif"
                  fontWeight={700}
                  fontSize={(h - b * 4) * 0.72}
                  textLength={Math.min(w - b * 6, (a.text ?? '').length * (h - b * 4) * 0.72 * 0.72)}
                  lengthAdjust="spacingAndGlyphs"
                >
                  {(a.text ?? '').toUpperCase()}
                </text>
              </g>
            )
          })}
        </g>
      )
    case 'image':
      return (
        <g {...common} opacity={a.opacity}>
          {local(a.rect!, (w, h) => (
            <>
              <rect width={w} height={h} fill="transparent" />
              <image href={a.image} width={w} height={h} preserveAspectRatio="none" />
            </>
          ))}
        </g>
      )
  }
}

function TextBox(props: { a: Annot; editing: boolean; selected: boolean; onText?: (t: string) => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const { a } = props
  useEffect(() => {
    if (props.editing && ref.current) {
      ref.current.focus()
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
  }, [props.editing])
  return (
    <div
      ref={ref}
      className={`text-annot${props.editing ? ' editing' : ''}`}
      contentEditable={props.editing}
      suppressContentEditableWarning
      style={{
        fontSize: a.fontSize,
        color: a.color,
        background: a.fill ?? 'transparent',
        lineHeight: 1.2
      }}
      onPointerDown={(e) => props.editing && e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur()
      }}
      onBlur={(e) => props.onText?.((e.currentTarget as HTMLElement).innerText.replace(/\n$/, ''))}
      data-placeholder="Type here"
    >
      {a.text}
    </div>
  )
}
