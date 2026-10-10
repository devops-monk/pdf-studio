import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Doc } from '@/store/docs'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'
import { PageView } from './PageView'

const PAD = 28
const GAP = 18
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 1000) / 1000))
}

/** Layers state (optional content) shared between the Layers panel and pages. */
export const ocStates = new Map<string, { config: unknown; version: number }>()

export function Viewer({ doc }: { doc: Doc }): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sizes, setSizes] = useState<{ width: number; height: number }[] | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const tool = useUi((s) => s.tool)
  const readMode = useUi((s) => s.readMode)
  const setView = useDocs((s) => s.setView)
  const { layout, fit, rotation } = doc.view
  const [, forceOc] = useState(0)
  const oc = ocStates.get(doc.id)

  useEffect(() => {
    const onOc = (): void => forceOc((n) => n + 1)
    window.addEventListener('pdfstudio:layers', onOc)
    return () => window.removeEventListener('pdfstudio:layers', onOc)
  }, [])

  // Unscaled page sizes, in display orientation.
  useEffect(() => {
    let live = true
    ;(async () => {
      const out: { width: number; height: number }[] = []
      for (let i = 1; i <= doc.pdf.numPages; i++) {
        const p = await doc.pdf.getPage(i)
        const v = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 })
        out.push({ width: v.width, height: v.height })
      }
      if (live) setSizes(out)
    })().catch(() => undefined)
    return () => {
      live = false
    }
  }, [doc.pdf, rotation])

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit modes compute the scale from the window size.
  const scale = useMemo(() => {
    if (!sizes || !fit || box.width === 0) return doc.view.scale
    const maxW = Math.max(...sizes.map((s) => s.width))
    const maxH = Math.max(...sizes.map((s) => s.height))
    const across = layout === 'twoUp' ? maxW * 2 + GAP : maxW
    const byWidth = (box.width - PAD * 2) / across
    if (fit === 'width') return clampZoom(byWidth)
    return clampZoom(Math.min(byWidth, (box.height - PAD * 2) / maxH))
  }, [sizes, fit, box, layout, doc.view.scale])

  useEffect(() => {
    if (Math.abs(scale - doc.view.scale) > 0.001) setView(doc.id, { scale })
  }, [scale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the reading position when zooming.
  const prevScale = useRef(scale)
  const laidOut = useRef(false)
  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ratio = scale / prevScale.current
    // The first fit after page sizes arrive is not a zoom: start at the top.
    if (!sizes || !laidOut.current) {
      if (sizes && box.width) laidOut.current = true
      prevScale.current = scale
      return
    }
    if (ratio !== 1) {
      const cx = el.scrollLeft + el.clientWidth / 2
      const cy = el.scrollTop + el.clientHeight / 2
      el.scrollLeft = cx * ratio - el.clientWidth / 2
      el.scrollTop = cy * ratio - el.clientHeight / 2
    }
    prevScale.current = scale
  }, [scale, sizes, box.width])

  // Navigation requests.
  useEffect(() => {
    if (!doc.scrollTo || layout === 'single') return
    const el = scrollRef.current!.querySelector<HTMLElement>(`[data-page="${doc.scrollTo.page}"]`)
    if (el) scrollRef.current!.scrollTop = el.offsetTop - 12
  }, [doc.scrollTo, layout])

  // Track the page in view.
  const raf = useRef(0)
  const onScroll = (): void => {
    if (layout === 'single') return
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      const probe = el.scrollTop + el.clientHeight * 0.35
      let current = 0
      for (const p of el.querySelectorAll<HTMLElement>('[data-page]')) {
        if (p.offsetTop <= probe) current = Number(p.dataset.page)
        else break
      }
      const d = useDocs.getState().get(doc.id)
      if (d && d.view.page !== current) setView(doc.id, { page: current })
    })
  }

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current!
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const d = useDocs.getState().get(doc.id)
      if (!d) return
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025))
      setView(doc.id, { scale: clampZoom(d.view.scale * factor), fit: null })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [doc.id, setView])

  // Hand tool: drag to pan.
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (tool !== 'hand' && e.button !== 1) return
    const el = scrollRef.current!
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!pan.current) return
    const el = scrollRef.current!
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x)
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y)
  }
  const onPointerUp = (): void => {
    pan.current = null
  }

  if (!sizes) return <div className="viewer" ref={scrollRef} />

  const page = (i: number): ReactNode => (
    <PageView
      key={`${i}`}
      docId={doc.id}
      pdf={doc.pdf}
      index={i}
      version={doc.version}
      scale={scale}
      rotation={rotation}
      base={sizes[i] ?? sizes[0]}
      ocConfig={oc?.config ?? null}
      ocVersion={oc?.version ?? 0}
    />
  )

  let content: ReactNode
  if (layout === 'single') {
    const i = Math.min(doc.view.page, sizes.length - 1)
    content = <div className="pages single">{page(i)}</div>
  } else if (layout === 'twoUp') {
    const rows: ReactNode[] = []
    for (let i = 0; i < sizes.length; i += 2) {
      rows.push(
        <div className="spread" key={i}>
          {page(i)}
          {i + 1 < sizes.length && page(i + 1)}
        </div>
      )
    }
    content = <div className="pages">{rows}</div>
  } else {
    content = <div className="pages">{sizes.map((_, i) => page(i))}</div>
  }

  return (
    <div
      ref={scrollRef}
      className={`viewer tool-${tool}${readMode ? ' read' : ''}`}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDownCapture={(e) => {
        // Clicking empty canvas clears the annotation selection.
        if ((e.target as Element).classList.contains('pages') || e.target === e.currentTarget) useUi.getState().set({ selectedAnnot: null })
      }}
    >
      {content}
    </div>
  )
}
