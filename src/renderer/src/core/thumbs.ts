import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from './pdf'

const cache = new WeakMap<PDFDocumentProxy, Map<string, Promise<string>>>()

// A small queue so scrolling a 500-page sidebar never starves the main view.
let running = 0
const queue: (() => void)[] = []
function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = (): void => {
      running++
      job()
        .then(resolve, reject)
        .finally(() => {
          running--
          queue.shift()?.()
        })
    }
    if (running < 3) start()
    else queue.push(start)
  })
}

export function thumbnail(pdf: PDFDocumentProxy, index: number, width: number): Promise<string> {
  let m = cache.get(pdf)
  if (!m) cache.set(pdf, (m = new Map()))
  const key = `${index}:${width}`
  let p = m.get(key)
  if (!p) {
    p = schedule(async () => {
      const page = await pdf.getPage(index + 1)
      const base = page.getViewport({ scale: 1 })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      return canvas.toDataURL('image/jpeg', 0.85)
    })
    m.set(key, p)
  }
  return p
}

/** Renders a thumbnail once its element scrolls near view. */
export function useThumbnail(pdf: PDFDocumentProxy, index: number, width: number): [React.RefObject<HTMLDivElement | null>, string | null] {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    const el = ref.current
    if (!el) return
    let live = true
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        thumbnail(pdf, index, width).then(
          (u) => live && setUrl(u),
          () => undefined
        )
      },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [pdf, index, width])
  return [ref, url]
}

/** Page aspect ratios (height / width, as displayed) for laying out thumbnails before they render. */
export function usePageRatios(pdf: PDFDocumentProxy): number[] {
  const [ratios, setRatios] = useState<number[]>([])
  useEffect(() => {
    let live = true
    ;(async () => {
      const out: number[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const v = (await pdf.getPage(i)).getViewport({ scale: 1 })
        out.push(v.height / v.width)
      }
      if (live) setRatios(out)
    })().catch(() => undefined)
    return () => {
      live = false
    }
  }, [pdf])
  return ratios
}
