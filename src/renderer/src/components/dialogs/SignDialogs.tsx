import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eraser, Trash2, Upload } from 'lucide-react'
import { findAll, rangeRects } from '@/core/search'
import { imageToDataUrl } from '@/core/tools'
import { uid, type Annot } from '@/core/types'
import { useDocs, type Doc } from '@/store/docs'
import { useUi } from '@/store/ui'
import { Dialog, Segmented, toast } from '../ui'

/* ---------------- Signatures ---------------- */

interface SavedSig {
  id: string
  dataUrl: string
  width: number
  height: number
  initials: boolean
}

const SCRIPT_FONTS = ['"Segoe Script"', '"Snell Roundhand"', '"Brush Script MT"', '"Lucida Handwriting"', 'cursive']

/** Crops a canvas to its inked area so placed signatures have no dead space. */
function trimmed(canvas: HTMLCanvasElement): { dataUrl: string; width: number; height: number } | null {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const pad = 6
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height }
}

export function SignatureDialog({ onClose, initials = false }: { onClose: () => void; initials?: boolean }): ReactNode {
  const [tab, setTab] = useState<'draw' | 'type' | 'image'>('draw')
  const [typed, setTyped] = useState('')
  const [font, setFont] = useState(SCRIPT_FONTS[0])
  const [color, setColor] = useState('#16243f')
  const [saved, setSaved] = useState<SavedSig[]>([])
  const [remember, setRemember] = useState(true)
  const [upload, setUpload] = useState<{ dataUrl: string; width: number; height: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const last = useRef<[number, number] | null>(null)

  useEffect(() => {
    window.api.prefs.get().then((p) => setSaved(((p.signatures as SavedSig[]) ?? []).filter((s) => s.initials === initials)))
  }, [initials])

  const ctx = (): CanvasRenderingContext2D => {
    const c = canvasRef.current!.getContext('2d')!
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = color
    return c
  }

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * canvasRef.current!.width, ((e.clientY - r.top) / r.height) * canvasRef.current!.height]
  }

  const place = (sig: { dataUrl: string; width: number; height: number }): void => {
    useUi.getState().setStyle({ pendingImage: { ...sig, signature: true } })
    useUi.getState().set({ toolGroup: useUi.getState().toolGroup ?? 'fillSign' })
    useUi.getState().setTool('image')
    toast.info(`Click where the ${initials ? 'initials go' : 'signature goes'}, or drag to size it.`)
    onClose()
  }

  const build = (): { dataUrl: string; width: number; height: number } | null => {
    if (tab === 'image') return upload
    if (tab === 'draw') return trimmed(canvasRef.current!)
    if (!typed.trim()) return null
    const c = document.createElement('canvas')
    const size = 96
    const m = c.getContext('2d')!
    m.font = `${size}px ${font}`
    const w = Math.ceil(m.measureText(typed).width) + 40
    c.width = w
    c.height = size * 1.6
    const g = c.getContext('2d')!
    g.font = `${size}px ${font}`
    g.fillStyle = color
    g.textBaseline = 'middle'
    g.fillText(typed, 20, c.height / 2)
    return trimmed(c)
  }

  const use = async (): Promise<void> => {
    const sig = build()
    if (!sig) {
      toast.info(tab === 'draw' ? 'Draw your signature first.' : tab === 'type' ? 'Type your name first.' : 'Choose an image first.')
      return
    }
    if (remember) {
      const all = ((await window.api.prefs.get()).signatures as SavedSig[]) ?? []
      await window.api.prefs.set('signatures', [{ id: uid(), ...sig, initials }, ...all].slice(0, 8))
    }
    place(sig)
  }

  const removeSaved = async (id: string): Promise<void> => {
    const all = ((await window.api.prefs.get()).signatures as SavedSig[]) ?? []
    await window.api.prefs.set(
      'signatures',
      all.filter((s) => s.id !== id)
    )
    setSaved(saved.filter((s) => s.id !== id))
  }

  return (
    <Dialog
      title={initials ? 'Add initials' : 'Add signature'}
      width={600}
      onClose={onClose}
      footer={
        <>
          <label className="check foot-note">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Save for next time
          </label>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={use}>
            Place on page
          </button>
        </>
      }
    >
      {saved.length > 0 && (
        <div className="saved-sigs">
          {saved.map((s) => (
            <div key={s.id} className="saved-sig">
              <button onClick={() => place(s)} aria-label="Use this signature">
                <img src={s.dataUrl} alt="Saved signature" />
              </button>
              <button className="icon-btn sm" aria-label="Forget this signature" onClick={() => removeSaved(s.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'draw', label: 'Draw' },
            { value: 'type', label: 'Type' },
            { value: 'image', label: 'Image' }
          ]}
        />
        <span className="grow" />
        {tab !== 'image' &&
          ['#16243f', '#1d2228', '#1d4ed8'].map((c) => (
            <button key={c} className={`swatch-btn${c === color ? ' on' : ''}`} style={{ background: c }} aria-label={`Ink ${c}`} onClick={() => setColor(c)} />
          ))}
      </div>
      {tab === 'draw' && (
        <div className="sig-pad">
          <canvas
            ref={canvasRef}
            width={1120}
            height={initials ? 300 : 360}
            onPointerDown={(e) => {
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              last.current = pos(e)
              const c = ctx()
              c.lineWidth = 5
              c.beginPath()
              c.arc(last.current[0], last.current[1], 2.5, 0, Math.PI * 2)
              c.fillStyle = color
              c.fill()
              setHasInk(true)
            }}
            onPointerMove={(e) => {
              if (!last.current) return
              const p = pos(e)
              const c = ctx()
              // Faster strokes come out thinner, like a real pen.
              const speed = Math.hypot(p[0] - last.current[0], p[1] - last.current[1])
              c.lineWidth = Math.max(2.5, 6 - speed * 0.06)
              c.beginPath()
              c.moveTo(last.current[0], last.current[1])
              c.lineTo(p[0], p[1])
              c.stroke()
              last.current = p
            }}
            onPointerUp={() => (last.current = null)}
          />
          <div className="sig-line">{hasInk ? '' : initials ? 'Draw your initials' : 'Sign here'}</div>
          <button
            className="btn sm ghost sig-clear"
            onClick={() => {
              const c = canvasRef.current!
              c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
              setHasInk(false)
            }}
          >
            <Eraser size={13} /> Clear
          </button>
        </div>
      )}
      {tab === 'type' && (
        <div className="stack">
          <input className="input" placeholder={initials ? 'Your initials' : 'Your name'} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="sig-fonts">
            {SCRIPT_FONTS.map((f) => (
              <button key={f} className={`sig-font${f === font ? ' on' : ''}`} style={{ fontFamily: f, color }} onClick={() => setFont(f)}>
                {typed || (initials ? 'AB' : 'Your Name')}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'image' && (
        <div className="sig-upload">
          {upload ? <img src={upload.dataUrl} alt="Signature" /> : <p className="muted">Use a scan or photo of your signature. PNG with a transparent background looks best.</p>}
          <button
            className="btn"
            onClick={async () => {
              const [f] = await window.api.openImages()
              if (f) setUpload(await imageToDataUrl(f.data))
            }}
          >
            <Upload size={14} /> Choose image…
          </button>
        </div>
      )}
    </Dialog>
  )
}

/* ---------------- Redact by search ---------------- */

export function RedactSearchDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [terms, setTerms] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(true)
  const [pattern, setPattern] = useState<'' | 'email' | 'phone' | 'card'>('')
  const [count, setCount] = useState<number | null>(null)

  const PATTERNS = {
    email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    phone: /(?:\+?\d[\d\s().-]{7,}\d)/g,
    card: /\b(?:\d[ -]?){13,19}\b/g
  }

  const collect = async (): Promise<{ page: number; start: number; end: number }[]> => {
    const out: { page: number; start: number; end: number }[] = []
    for (const term of terms.split('\n').map((t) => t.trim()).filter(Boolean)) out.push(...(await findAll(doc.pdf, term, { matchCase, wholeWord })))
    if (pattern) {
      const { getPageText } = await import('@/core/search')
      for (let i = 0; i < doc.numPages; i++) {
        const { text } = await getPageText(doc.pdf, i)
        for (const m of text.matchAll(PATTERNS[pattern])) out.push({ page: i, start: m.index!, end: m.index! + m[0].length })
      }
    }
    return out
  }

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      const r = await collect()
      if (live) setCount(r.length)
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [terms, matchCase, wholeWord, pattern]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (): Promise<void> => {
    const matches = await collect()
    const marks: Annot[] = []
    for (const m of matches) {
      for (const rect of await rangeRects(doc.pdf, m.page, m.start, m.end)) {
        marks.push({ id: uid(), page: m.page, kind: 'redact', color: '#000000', opacity: 1, width: 0, rotation: 0, createdAt: Date.now(), rect })
      }
    }
    if (!marks.length) return
    const d = useDocs.getState().get(doc.id)!
    useDocs.getState().setAnnots(doc.id, [...d.annots, ...marks], 'Mark text for redaction')
    useUi.getState().set({ toolGroup: 'redact' })
    toast.ok(`Marked ${matches.length} match${matches.length === 1 ? '' : 'es'}. Review them, then choose Apply.`)
    onClose()
  }

  return (
    <Dialog
      title="Find text to redact"
      width={480}
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{count === null ? '' : `${count} match${count === 1 ? '' : 'es'}`}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!count} onClick={run}>
            Mark matches
          </button>
        </>
      }
    >
      <label className="field">
        <span>Words or phrases, one per line</span>
        <textarea className="textarea" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={'Jane Doe\nAccount 4471'} />
      </label>
      <div className="row wrap">
        <label className="check">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
        </label>
        <label className="check">
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words
        </label>
      </div>
      <label className="field">
        <span>Also find</span>
        <select className="select" value={pattern} onChange={(e) => setPattern(e.target.value as typeof pattern)}>
          <option value="">Nothing else</option>
          <option value="email">Email addresses</option>
          <option value="phone">Phone numbers</option>
          <option value="card">Card numbers</option>
        </select>
      </label>
    </Dialog>
  )
}
