import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { pdfjs, formatBytes, fileStem } from '@/core/pdf'
import {
  addPageNumbers,
  addWatermark,
  listFonts,
  optimize,
  parsePageRanges,
  setInfo,
  type FontInfo,
  type PageNumberOptions,
  type Permissions,
  type WatermarkOptions
} from '@/core/ops'
import { rasterizeAll } from '@/core/tools'
import { useDocs, type Doc } from '@/store/docs'
import { Dialog, Segmented, toast, withBusy } from '../ui'
import { PageRange, Preview, saveBytesAs, usePagePreview } from './common'

/* ---------------- Properties ---------------- */

type PropTab = 'description' | 'document' | 'fonts' | 'security'

function fmtDate(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '—'
  const d = pdfjs.PDFDateString.toDateObject(raw)
  return d ? d.toLocaleString() : raw
}

function paperName(w: number, h: number): string {
  const [a, b] = [Math.min(w, h), Math.max(w, h)]
  const near = (x: number, y: number): boolean => Math.abs(a - x) < 3 && Math.abs(b - y) < 3
  if (near(595, 842)) return 'A4'
  if (near(612, 792)) return 'Letter'
  if (near(612, 1008)) return 'Legal'
  if (near(842, 1191)) return 'A3'
  if (near(420, 595)) return 'A5'
  return ''
}

export function PropertiesDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<PropTab>('description')
  const [meta, setMeta] = useState<{ info: Record<string, unknown>; size: string; version: string } | null>(null)
  const [form, setForm] = useState({ title: '', author: '', subject: '', keywords: '' })
  const [fonts, setFonts] = useState<FontInfo[] | null>(null)
  const [perms, setPerms] = useState<number[] | null>(null)
  const [hasForm, setHasForm] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { info } = await doc.pdf.getMetadata()
      const i = info as Record<string, unknown>
      const p1 = (await doc.pdf.getPage(1)).getViewport({ scale: 1 })
      const w = p1.width / 72
      const h = p1.height / 72
      const paper = paperName(p1.width, p1.height)
      setMeta({
        info: i,
        size: `${(w * 25.4).toFixed(0)} × ${(h * 25.4).toFixed(0)} mm (${w.toFixed(2)} × ${h.toFixed(2)} in)${paper ? ` · ${paper}` : ''}`,
        version: String(i.PDFFormatVersion ?? '?')
      })
      setHasForm(!!i.IsAcroFormPresent)
      setForm({ title: String(i.Title ?? ''), author: String(i.Author ?? ''), subject: String(i.Subject ?? ''), keywords: String(i.Keywords ?? '') })
      const p = await doc.pdf.getPermissions()
      setPerms(p ? [...p] : null)
    })()
  }, [doc.pdf])

  useEffect(() => {
    if (tab === 'fonts' && fonts === null) listFonts(doc.bytes).then(setFonts, () => setFonts([]))
  }, [tab, fonts, doc.bytes])

  const original = meta
    ? { title: String(meta.info.Title ?? ''), author: String(meta.info.Author ?? ''), subject: String(meta.info.Subject ?? ''), keywords: String(meta.info.Keywords ?? '') }
    : null
  const changed = original && (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== original[k])

  const save = (): void => {
    withBusy('Updating properties…', async () => {
      if (await useDocs.getState().apply(doc.id, 'Edit properties', (b) => setInfo(b, form))) {
        toast.ok('Properties updated. Save to keep them.')
        onClose()
      }
    })
  }

  const F = pdfjs.PermissionFlag
  const permRows: [string, number][] = [
    ['Printing', F.PRINT],
    ['High-quality printing', F.PRINT_HIGH_QUALITY],
    ['Changing the document', F.MODIFY_CONTENTS],
    ['Copying text and images', F.COPY],
    ['Commenting', F.MODIFY_ANNOTATIONS],
    ['Filling in forms', F.FILL_INTERACTIVE_FORMS],
    ['Page assembly', F.ASSEMBLE]
  ]

  return (
    <Dialog
      title="Document properties"
      width={580}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {changed ? 'Cancel' : 'Close'}
          </button>
          {tab === 'description' && (
            <button className="btn primary" disabled={!changed} onClick={save}>
              Apply changes
            </button>
          )}
        </>
      }
    >
      <Segmented<PropTab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'description', label: 'Description' },
          { value: 'document', label: 'Document' },
          { value: 'fonts', label: 'Fonts' },
          { value: 'security', label: 'Security' }
        ]}
      />
      {tab === 'description' && (
        <div className="stack">
          {(['title', 'author', 'subject', 'keywords'] as const).map((k) => (
            <label className="field" key={k}>
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input className="input" value={form[k]} placeholder={k === 'keywords' ? 'Separate with commas' : ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      )}
      {tab === 'document' && meta && (
        <dl className="props">
          <dt>File</dt>
          <dd className="selectable">{doc.path ?? `${doc.name} (not saved yet)`}</dd>
          <dt>File size</dt>
          <dd>{formatBytes(doc.bytes.length)}</dd>
          <dt>Pages</dt>
          <dd>{doc.numPages}</dd>
          <dt>Page size</dt>
          <dd>{meta.size}</dd>
          <dt>PDF version</dt>
          <dd>{meta.version}</dd>
          <dt>Created</dt>
          <dd>{fmtDate(meta.info.CreationDate)}</dd>
          <dt>Modified</dt>
          <dd>{fmtDate(meta.info.ModDate)}</dd>
          <dt>Application</dt>
          <dd>{String(meta.info.Creator ?? '—')}</dd>
          <dt>PDF producer</dt>
          <dd>{String(meta.info.Producer ?? '—')}</dd>
          <dt>Tagged</dt>
          <dd>{meta.info.IsMarked ? 'Yes' : 'No'}</dd>
          <dt>Form fields</dt>
          <dd>{hasForm ? 'Yes' : 'No'}</dd>
        </dl>
      )}
      {tab === 'fonts' &&
        (fonts === null ? (
          <p className="muted">Reading fonts…</p>
        ) : fonts.length === 0 ? (
          <p className="muted">No fonts are used directly on the pages (the text may be drawn as images or paths).</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Font</th>
                <th>Type</th>
                <th>Embedded</th>
              </tr>
            </thead>
            <tbody>
              {fonts.map((f) => (
                <tr key={f.name + f.type}>
                  <td className="selectable">{f.name}</td>
                  <td>{f.type}</td>
                  <td>{f.embedded ? 'Yes' : <span className="warn">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {tab === 'security' && (
        <div className="stack">
          <p>
            <Lock size={13} style={{ verticalAlign: -2 }} />{' '}
            {doc.protection
              ? 'Password protected (AES-256 on save). Anyone opening the file needs the password.'
              : doc.wasEncrypted
                ? 'The original file had restrictions without an open password. Saving writes an unrestricted copy.'
                : 'No password or restrictions.'}
          </p>
          {perms && (
            <table className="table">
              <tbody>
                {permRows.map(([label, flag]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{perms.includes(flag) ? 'Allowed' : <span className="warn">Not allowed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Dialog>
  )
}

/* ---------------- Protect ---------------- */

export function ProtectDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [restrict, setRestrict] = useState(false)
  const [owner, setOwner] = useState('')
  const [perm, setPerm] = useState<Permissions>({ printing: true, copying: true, modifying: false, annotating: true, fillingForms: true, documentAssembly: false })

  const strength = pw.length === 0 ? '' : pw.length < 6 ? 'Weak' : pw.length < 10 || !/[^a-zA-Z]/.test(pw) ? 'Fair' : 'Strong'
  const mismatch = confirm.length > 0 && pw !== confirm
  const ownerMissing = restrict && owner.length === 0
  const ok = pw.length > 0 && pw === confirm && !ownerMissing

  const run = (): void => {
    if (!ok) return
    useDocs.getState().patch(doc.id, {
      protection: { userPassword: pw, ownerPassword: restrict ? owner : undefined, permissions: restrict ? perm : undefined },
      dirty: true
    })
    toast.ok('Password set. It takes effect when you save.', { label: 'Save now', run: () => useDocs.getState().save(doc.id) })
    onClose()
  }

  const labels: [keyof Permissions, string][] = [
    ['printing', 'Print'],
    ['copying', 'Copy text and images'],
    ['modifying', 'Change the document'],
    ['annotating', 'Add comments'],
    ['fillingForms', 'Fill in forms'],
    ['documentAssembly', 'Insert, delete and rotate pages']
  ]

  return (
    <Dialog
      title="Protect with a password"
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok} onClick={run}>
            Protect
          </button>
        </>
      }
    >
      <label className="field">
        <span>Password to open</span>
        <div className="input-with-btn">
          <input className="input" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <button className="icon-btn sm" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {strength && <span className={`strength ${strength.toLowerCase()}`}>{strength}</span>}
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input className={`input${mismatch ? ' invalid' : ''}`} type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <span className="field-hint error">The passwords don’t match.</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
        Restrict what people can do after opening
      </label>
      {restrict && (
        <div className="indent stack">
          <div className="grid-2">
            {labels.map(([k, l]) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={perm[k]} onChange={(e) => setPerm({ ...perm, [k]: e.target.checked })} />
                {l}
              </label>
            ))}
          </div>
          <label className="field">
            <span>Permissions password (to lift restrictions)</span>
            <input className={`input${ownerMissing ? ' invalid' : ''}`} type={show ? 'text' : 'password'} value={owner} onChange={(e) => setOwner(e.target.value)} />
            <span className="field-hint">Must differ from the open password, or restrictions can be lifted by anyone who can open the file.</span>
          </label>
        </div>
      )}
      <p className="field-hint">Encrypted with AES-256. If you forget the password, the document can’t be recovered.</p>
    </Dialog>
  )
}

/* ---------------- Watermark ---------------- */

export function WatermarkDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [o, setO] = useState<Omit<WatermarkOptions, 'pages'>>({
    text: 'CONFIDENTIAL',
    fontSize: 64,
    color: '#c63b2f',
    opacity: 0.18,
    angle: 45,
    layout: 'center',
    bold: true
  })
  const [range, setRange] = useState('')
  const pages = range.trim() ? parsePageRanges(range, doc.numPages) : 'all'
  const preview = usePagePreview(doc, doc.view.page, (b) => addWatermark(b, { ...o, pages: 'all' }), [o])

  const run = (): void => {
    if (!pages || !o.text.trim()) return
    withBusy('Adding watermark…', async () => {
      if (await useDocs.getState().apply(doc.id, 'Add watermark', (b) => addWatermark(b, { ...o, pages }))) onClose()
    })
  }

  return (
    <Dialog
      title="Add watermark"
      width={760}
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pages || !o.text.trim()} onClick={run}>
            Add watermark
          </button>
        </>
      }
    >
      <div className="split-pane">
        <div className="stack">
          <label className="field">
            <span>Text</span>
            <input className="input" value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Size</span>
              <input className="input" type="number" min={8} max={300} value={o.fontSize} onChange={(e) => setO({ ...o, fontSize: Number(e.target.value) || 64 })} />
            </label>
            <label className="field">
              <span>Color</span>
              <div className="row">
                <input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} />
                <label className="check">
                  <input type="checkbox" checked={o.bold} onChange={(e) => setO({ ...o, bold: e.target.checked })} /> Bold
                </label>
              </div>
            </label>
          </div>
          <label className="field">
            <span>Opacity · {Math.round(o.opacity * 100)}%</span>
            <input type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => setO({ ...o, opacity: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Angle · {o.angle}°</span>
            <input type="range" min={-90} max={90} step={5} value={o.angle} onChange={(e) => setO({ ...o, angle: Number(e.target.value) })} />
          </label>
          <div className="field">
            <span>Layout</span>
            <Segmented
              value={o.layout}
              onChange={(layout) => setO({ ...o, layout })}
              options={[
                { value: 'center', label: 'Once, centred' },
                { value: 'tile', label: 'Tiled' }
              ]}
            />
          </div>
          <PageRange count={doc.numPages} value={range} onChange={setRange} label="Pages (leave empty for all)" />
        </div>
        <Preview url={preview} label={`Page ${doc.view.page + 1}`} />
      </div>
    </Dialog>
  )
}

/* ---------------- Page numbers ---------------- */

const FORMATS = ['{n}', 'Page {n}', 'Page {n} of {total}', '{n} / {total}', '- {n} -']

export function PageNumbersDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [o, setO] = useState<Omit<PageNumberOptions, 'pages'>>({
    format: 'Page {n} of {total}',
    position: 'bottom-center',
    fontSize: 10,
    margin: 28,
    color: '#333333',
    startAt: 1
  })
  const [range, setRange] = useState('')
  const pages = range.trim() ? parsePageRanges(range, doc.numPages) : 'all'
  const previewOp = useMemo(
    () => (b: Uint8Array) => addPageNumbers(b, { ...o, pages: 'all', format: o.format.replaceAll('{total}', String(doc.numPages + o.startAt - 1)), startAt: doc.view.page + o.startAt }),
    [o, doc.numPages, doc.view.page]
  )
  const preview = usePagePreview(doc, doc.view.page, previewOp, [previewOp])

  const run = (): void => {
    if (!pages) return
    withBusy('Adding page numbers…', async () => {
      if (await useDocs.getState().apply(doc.id, 'Add page numbers', (b) => addPageNumbers(b, { ...o, pages }))) onClose()
    })
  }

  const positions: PageNumberOptions['position'][] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']

  return (
    <Dialog
      title="Add page numbers"
      width={740}
      onClose={onClose}
      onSubmit={run}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pages} onClick={run}>
            Add numbers
          </button>
        </>
      }
    >
      <div className="split-pane">
        <div className="stack">
          <label className="field">
            <span>Format</span>
            <input className="input" list="pn-formats" value={o.format} onChange={(e) => setO({ ...o, format: e.target.value })} />
            <datalist id="pn-formats">
              {FORMATS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <span className="field-hint">{'{n}'} is the page number, {'{total}'} the page count.</span>
          </label>
          <div className="field">
            <span>Position</span>
            <div className="pos-grid" role="radiogroup" aria-label="Position">
              {positions.map((p) => (
                <button key={p} role="radio" aria-checked={o.position === p} aria-label={p.replace('-', ' ')} className={o.position === p ? 'on' : ''} onClick={() => setO({ ...o, position: p })}>
                  <i />
                </button>
              ))}
            </div>
          </div>
          <div className="grid-2">
            <label className="field">
              <span>Font size</span>
              <input className="input" type="number" min={6} max={48} value={o.fontSize} onChange={(e) => setO({ ...o, fontSize: Number(e.target.value) || 10 })} />
            </label>
            <label className="field">
              <span>Margin (pt)</span>
              <input className="input" type="number" min={4} max={144} value={o.margin} onChange={(e) => setO({ ...o, margin: Number(e.target.value) || 28 })} />
            </label>
            <label className="field">
              <span>Start at</span>
              <input className="input" type="number" min={0} value={o.startAt} onChange={(e) => setO({ ...o, startAt: Number(e.target.value) || 1 })} />
            </label>
            <label className="field">
              <span>Color</span>
              <input type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} />
            </label>
          </div>
          <PageRange count={doc.numPages} value={range} onChange={setRange} label="Pages (leave empty for all)" />
        </div>
        <Preview url={preview} label={`Page ${doc.view.page + 1}`} />
      </div>
    </Dialog>
  )
}

/* ---------------- Compress ---------------- */

export function CompressDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): ReactNode {
  const [mode, setMode] = useState<'lossless' | 'images'>('lossless')
  const [strip, setStrip] = useState(true)
  const [dropComments, setDropComments] = useState(false)
  const [dpi, setDpi] = useState(120)
  const [quality, setQuality] = useState(0.7)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [before, setBefore] = useState<number | null>(null)

  useEffect(() => setResult(null), [mode, strip, dropComments, dpi, quality])

  const compute = (): void => {
    withBusy('Compressing…', async (progress) => {
      const base = await useDocs.getState().committed(doc.id)
      setBefore(base.length)
      const out = mode === 'lossless' ? await optimize(base, { stripMetadata: strip, removeComments: dropComments }) : await rasterizeAll(base, dpi, quality, progress)
      setResult(out)
    })
  }

  const saving = result && before ? 1 - result.length / before : 0

  return (
    <Dialog
      title="Compress"
      width={520}
      onClose={onClose}
      footer={
        result ? (
          <>
            <button className="btn" onClick={() => setResult(null)}>
              Back
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (await saveBytesAs(`${fileStem(doc.name)} compressed.pdf`, result)) onClose()
              }}
            >
              Save as new file…
            </button>
            <button
              className="btn primary"
              disabled={saving <= 0}
              onClick={async () => {
                const r = result
                if (await useDocs.getState().apply(doc.id, 'Compress', async () => r)) onClose()
              }}
            >
              Use in this document
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={compute}>
              Compress
            </button>
          </>
        )
      }
    >
      {result && before ? (
        <div className="compress-result">
          <div className="size-compare">
            <div>
              <span className="faint small">Before</span>
              <strong>{formatBytes(before)}</strong>
            </div>
            <div className="size-bar">
              <i style={{ width: `${Math.min(100, (result.length / before) * 100)}%` }} />
            </div>
            <div>
              <span className="faint small">After</span>
              <strong>{formatBytes(result.length)}</strong>
            </div>
          </div>
          <p>
            {saving > 0.01
              ? `${Math.round(saving * 100)}% smaller.`
              : 'This file is already compact; this method can’t make it smaller. Try converting pages to images for scanned documents.'}
          </p>
        </div>
      ) : (
        <>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'lossless', label: 'Keep quality' },
              { value: 'images', label: 'Smallest file' }
            ]}
          />
          {mode === 'lossless' ? (
            <div className="stack">
              <p className="muted">Repacks the file’s structure into compressed object streams. Text and images are unchanged.</p>
              <label className="check">
                <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} /> Remove hidden metadata and thumbnails
              </label>
              <label className="check">
                <input type="checkbox" checked={dropComments} onChange={(e) => setDropComments(e.target.checked)} /> Remove comments
              </label>
            </div>
          ) : (
            <div className="stack">
              <p className="muted">Turns every page into a JPEG image. Best for scans. Text stops being selectable; run Recognize Text afterwards to make it searchable again.</p>
              <label className="field">
                <span>Resolution · {dpi} dpi</span>
                <input type="range" min={72} max={300} step={12} value={dpi} onChange={(e) => setDpi(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Image quality · {Math.round(quality * 100)}%</span>
                <input type="range" min={0.3} max={0.95} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              </label>
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}
