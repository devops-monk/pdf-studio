import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { pdfjs, outputScale, destToPageIndex, type PDFDocumentProxy, type PDFPageProxy, type PageViewport } from '@/core/pdf'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'
import { AnnotOverlay } from './AnnotOverlay'

interface Props {
  docId: string
  pdf: PDFDocumentProxy
  index: number
  version: number
  scale: number
  /** View-only rotation added on top of the page's own /Rotate. */
  rotation: number
  /** Unscaled, rotated size, known before the page loads. */
  base: { width: number; height: number }
  /** Optional-content config for layer visibility, if the user toggled any. */
  ocConfig: unknown
  ocVersion: number
}

function makeLinkService(docId: string, pdf: PDFDocumentProxy) {
  const nav = (i: number): void => useDocs.getState().goTo(docId, i)
  const current = (): number => useDocs.getState().get(docId)?.view.page ?? 0
  return {
    externalLinkEnabled: true,
    isInPresentationMode: false,
    get pagesCount() {
      return pdf.numPages
    },
    get page() {
      return current() + 1
    },
    set page(n: number) {
      nav(n - 1)
    },
    rotation: 0,
    eventBus: undefined,
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer nofollow'
      link.title = url
    },
    getDestinationHash: () => '#',
    getAnchorUrl: () => '#',
    async goToDestination(dest: unknown) {
      const i = await destToPageIndex(pdf, dest)
      if (i != null) nav(i)
    },
    goToPage: (n: number) => nav(n - 1),
    executeNamedAction(action: string) {
      const p = current()
      const map: Record<string, number> = { NextPage: p + 1, PrevPage: p - 1, FirstPage: 0, LastPage: pdf.numPages - 1 }
      if (action in map) nav(map[action])
    },
    executeSetOCGState: () => undefined,
    setHash: () => undefined
  }
}

/** Highlights find results by measuring text ranges inside the text layer. */
function paintMatches(layer: HTMLElement, host: HTMLElement, items: string[], matches: { start: number; end: number; current: boolean }[]): void {
  host.replaceChildren()
  if (!matches.length) return
  const divs = Array.from(layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')).filter(
    (el) => el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE
  )
  // Rebuild the same offsets that page text extraction used: item text plus "\n" at EOLs.
  const spans: { el: HTMLElement; start: number; end: number }[] = []
  let offset = 0
  let d = 0
  for (const s of items) {
    if (s === '\n') {
      offset += 1
      continue
    }
    const el = divs[d]
    if (el && el.textContent === s) {
      spans.push({ el, start: offset, end: offset + s.length })
      d++
    }
    offset += s.length
  }
  const hostBox = host.getBoundingClientRect()
  for (const m of matches) {
    for (const sp of spans) {
      if (sp.end <= m.start || sp.start >= m.end) continue
      const node = sp.el.firstChild as Text
      const range = document.createRange()
      range.setStart(node, Math.max(0, m.start - sp.start))
      range.setEnd(node, Math.min(node.length, m.end - sp.start))
      for (const r of Array.from(range.getClientRects())) {
        const box = document.createElement('div')
        box.className = m.current ? 'find-hit current' : 'find-hit'
        box.style.left = `${r.left - hostBox.left}px`
        box.style.top = `${r.top - hostBox.top}px`
        box.style.width = `${r.width}px`
        box.style.height = `${r.height}px`
        host.append(box)
        if (m.current) box.scrollIntoView({ block: 'center', inline: 'nearest' })
      }
    }
  }
}

export const PageView = memo(function PageView(props: Props): ReactNode {
  const { docId, pdf, index, version, scale, rotation, base } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const annRef = useRef<HTMLDivElement>(null)
  const hitsRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [textItems, setTextItems] = useState<string[] | null>(null)
  const [rendered, setRendered] = useState<{ scale: number; version: number } | null>(null)

  const find = useUi((s) => s.find)
  const readMode = useUi((s) => s.readMode)

  // Only pages near the viewport get rendered.
  useEffect(() => {
    const el = wrapRef.current!
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let live = true
    pdf.getPage(index + 1).then(
      (p) => live && setPage(p),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [visible, pdf, index, version])

  useLayoutEffect(() => {
    if (page) setViewport(page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 }))
  }, [page, scale, rotation])

  // Canvas
  useEffect(() => {
    if (!page || !viewport || !visible) return
    const canvas = canvasRef.current!
    const ratio = outputScale(viewport)
    const off = document.createElement('canvas')
    off.width = Math.floor(viewport.width * ratio)
    off.height = Math.floor(viewport.height * ratio)
    const ctx = off.getContext('2d', { alpha: false })!
    const task = page.render({
      canvas: off,
      canvasContext: ctx,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
      optionalContentConfigPromise: props.ocConfig ? Promise.resolve(props.ocConfig as never) : undefined
    })
    task.promise.then(
      () => {
        // Swap in the finished frame at once so zooming never flashes blank.
        canvas.width = off.width
        canvas.height = off.height
        canvas.getContext('2d')!.drawImage(off, 0, 0)
        setRendered({ scale, version })
      },
      () => undefined
    )
    return () => task.cancel()
  }, [page, viewport, visible, version, props.ocConfig, props.ocVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // Text layer (selection, copy, find)
  useEffect(() => {
    if (!page || !viewport || !visible) return
    const container = textRef.current!
    container.replaceChildren()
    const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true }), container, viewport })
    let live = true
    layer.render().then(
      async () => {
        if (!live) return
        const end = document.createElement('div')
        end.className = 'endOfContent'
        container.append(end)
        const content = await page.getTextContent()
        if (!live) return
        const items: string[] = []
        for (const it of content.items) {
          if (!('str' in it)) continue
          items.push(it.str)
          if (it.hasEOL) items.push('\n')
        }
        setTextItems(items)
      },
      () => undefined
    )
    return () => {
      live = false
      layer.cancel()
    }
  }, [page, viewport, visible, version])

  // Links, existing comments and interactive form fields
  useEffect(() => {
    if (!page || !viewport || !visible) return
    const div = annRef.current!
    div.replaceChildren()
    let live = true
    ;(async () => {
      const annotations = await page.getAnnotations({ intent: 'display' })
      if (!live || annotations.length === 0) return
      const layer = new pdfjs.AnnotationLayer({
        div,
        page,
        viewport: viewport.clone({ dontFlip: true }),
        linkService: makeLinkService(docId, pdf) as never,
        annotationStorage: pdf.annotationStorage,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        commentManager: null
      } as never)
      await layer.render({
        annotations,
        viewport: viewport.clone({ dontFlip: true }),
        renderForms: true,
        imageResourcesPath: '',
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: null
      } as never)
    })().catch((err) => console.warn('annotation layer', err))
    return () => {
      live = false
    }
  }, [page, viewport, visible, version, docId, pdf])

  // Find highlights
  useEffect(() => {
    const host = hitsRef.current
    const layer = textRef.current
    if (!host || !layer || !textItems) return
    const results = find.open ? find.results : []
    const mine = results
      .map((r, i) => ({ ...r, current: i === find.current }))
      .filter((r) => r.page === index)
    // Wait a frame so text spans have their final layout.
    const raf = requestAnimationFrame(() => paintMatches(layer, host, textItems, mine))
    return () => cancelAnimationFrame(raf)
  }, [find.open, find.results, find.current, textItems, index, viewport])

  const w = viewport?.width ?? base.width * scale
  const h = viewport?.height ?? base.height * scale
  const stale = rendered && (rendered.scale !== scale || rendered.version !== version)

  return (
    <div
      ref={wrapRef}
      className={`page${readMode ? ' read' : ''}`}
      data-page={index}
      style={
        {
          width: w,
          height: h,
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px'
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} className={stale ? 'page-canvas stale' : 'page-canvas'} />
      <div ref={textRef} className="textLayer" />
      <div ref={hitsRef} className="find-layer" />
      <div ref={annRef} className="annotationLayer" />
      {viewport && <AnnotOverlay docId={docId} index={index} viewport={viewport} pageRotation={page?.rotate ?? 0} />}
      {!rendered && <div className="page-loading" aria-hidden />}
    </div>
  )
})
