import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Columns2,
  Eraser,
  Hand,
  Highlighter,
  Image as ImageIcon,
  LayoutGrid,
  Minus,
  MousePointer2,
  PenLine,
  Pencil,
  Plus,
  Redo2,
  RotateCw,
  Save,
  ScrollText,
  Search,
  Signature,
  Square,
  SquareDashed,
  Stamp,
  StickyNote,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  Calendar,
  Trash2,
  File as FileIcon,
  Wand2,
  ShieldCheck
} from 'lucide-react'
import type { Doc } from '@/store/docs'
import { useDocs } from '@/store/docs'
import { useUi, type Tool } from '@/store/ui'
import { MOD, SHIFT, runCommand } from '@/commands'
import { STAMP_PRESETS } from '@/core/annots'
import { applyRedactions, imageToDataUrl } from '@/core/tools'
import { clampZoom } from './viewer/Viewer'
import { Segmented, toast } from './ui'

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const COLORS = ['#f5c518', '#ff8a3d', '#e5484d', '#d6409f', '#8e4ec6', '#2a62b8', '#12a594', '#46a758', '#1d2228']

function PageNav({ doc }: { doc: Doc }): ReactNode {
  const [text, setText] = useState(String(doc.view.page + 1))
  useEffect(() => setText(String(doc.view.page + 1)), [doc.view.page])
  const go = (): void => {
    const n = parseInt(text, 10)
    if (Number.isFinite(n)) useDocs.getState().goTo(doc.id, n - 1)
    else setText(String(doc.view.page + 1))
  }
  return (
    <div className="page-nav">
      <button className="icon-btn" aria-label="Previous page" disabled={doc.view.page === 0} onClick={() => runCommand('view.prevPage')}>
        <ChevronLeft size={17} />
      </button>
      <input
        className="page-input"
        aria-label="Page number"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={go}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            go()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onFocus={(e) => e.target.select()}
      />
      <span className="page-total">of {doc.numPages}</span>
      <button className="icon-btn" aria-label="Next page" disabled={doc.view.page >= doc.numPages - 1} onClick={() => runCommand('view.nextPage')}>
        <ChevronRight size={17} />
      </button>
    </div>
  )
}

function Menu(props: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; className?: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={props.className ?? 'btn ghost sm'} aria-haspopup="menu" aria-expanded={open} title={props.title} onClick={() => setOpen(!open)}>
        {props.label}
      </button>
      {open && (
        <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function Zoom({ doc }: { doc: Doc }): ReactNode {
  const setView = useDocs((s) => s.setView)
  const pct = Math.round(doc.view.scale * 100)
  return (
    <div className="zoom">
      <button className="icon-btn" aria-label="Zoom out" title={`Zoom out (${MOD}−)`} onClick={() => runCommand('view.zoomOut')}>
        <Minus size={15} />
      </button>
      <Menu label={<>{pct}%<ChevronDown size={12} /></>} title="Zoom" className="zoom-value">
        {(close) => (
          <>
            {[
              ['Fit width', () => setView(doc.id, { fit: 'width' })],
              ['Fit page', () => setView(doc.id, { fit: 'page' })]
            ].map(([l, f]) => (
              <button key={l as string} role="menuitem" className={doc.view.fit === (l === 'Fit width' ? 'width' : 'page') ? 'on' : ''} onClick={() => ((f as () => void)(), close())}>
                {l as string}
              </button>
            ))}
            <hr />
            {ZOOMS.map((z) => (
              <button key={z} role="menuitem" className={!doc.view.fit && Math.abs(doc.view.scale - z) < 0.001 ? 'on' : ''} onClick={() => (setView(doc.id, { scale: clampZoom(z), fit: null }), close())}>
                {z * 100}%
              </button>
            ))}
          </>
        )}
      </Menu>
      <button className="icon-btn" aria-label="Zoom in" title={`Zoom in (${MOD}+)`} onClick={() => runCommand('view.zoomIn')}>
        <Plus size={15} />
      </button>
    </div>
  )
}

export function Toolbar({ doc }: { doc: Doc }): ReactNode {
  const mode = useUi((s) => s.mode)
  const group = useUi((s) => s.toolGroup)
  const tool = useUi((s) => s.tool)
  const readMode = useUi((s) => s.readMode)
  const setView = useDocs((s) => s.setView)
  const canUndo = doc.past.length > 0
  const canRedo = doc.future.length > 0
  const undoLabel = canUndo ? `Undo ${doc.past.at(-1)!.label.toLowerCase()}` : 'Nothing to undo'
  const redoLabel = canRedo ? `Redo ${doc.future[0].label.toLowerCase()}` : 'Nothing to redo'

  return (
    <div className="toolbar" role="toolbar" aria-label="Document">
      <div className="tb-group">
        {mode === 'view' && (
          <Segmented<Tool>
            value={tool === 'hand' ? 'hand' : 'select'}
            onChange={(t) => useUi.getState().setTool(t)}
            options={[
              { value: 'select', label: <MousePointer2 size={14} />, title: 'Select text and comments (V)' },
              { value: 'hand', label: <Hand size={14} />, title: 'Pan (H, or hold Space)' }
            ]}
          />
        )}
        <button className="icon-btn" aria-label={undoLabel} title={`${undoLabel} (${MOD}Z)`} disabled={!canUndo} onClick={() => runCommand('edit.undo')}>
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" aria-label={redoLabel} title={redoLabel} disabled={!canRedo} onClick={() => runCommand('edit.redo')}>
          <Redo2 size={16} />
        </button>
      </div>

      {mode === 'view' && (
        <div className="tb-group center">
          <PageNav doc={doc} />
          <span className="tb-sep" />
          <Zoom doc={doc} />
          <span className="tb-sep" />
          <Segmented
            value={doc.view.layout}
            onChange={(layout) => setView(doc.id, { layout })}
            options={[
              { value: 'continuous', label: <ScrollText size={14} />, title: 'Continuous' },
              { value: 'single', label: <FileIcon size={14} />, title: 'Single page' },
              { value: 'twoUp', label: <Columns2 size={14} />, title: 'Two pages' }
            ]}
          />
          <button className="icon-btn" aria-label="Rotate view" title={`Rotate view (${MOD}])`} onClick={() => runCommand('view.rotateCw')}>
            <RotateCw size={15} />
          </button>
          <button className={`icon-btn${readMode ? ' active' : ''}`} aria-label="Read mode" title={`Read mode (${MOD}${SHIFT}R)`} onClick={() => runCommand('view.readMode')}>
            <BookOpen size={15} />
          </button>
        </div>
      )}
      {mode === 'organize' && <div className="tb-group center organize-title">Organize pages</div>}

      <div className="tb-group right">
        <button className={`tool-btn${group === 'comment' ? ' on' : ''}`} onClick={() => runCommand('tool.comment')}>
          <Highlighter size={15} />
          <span>Comment</span>
        </button>
        <button className={`tool-btn${group === 'fillSign' ? ' on' : ''}`} onClick={() => runCommand('tool.fillSign')}>
          <PenLine size={15} />
          <span>Fill &amp; Sign</span>
        </button>
        <button className={`tool-btn${mode === 'organize' ? ' on' : ''}`} onClick={() => runCommand('tool.organize')}>
          <LayoutGrid size={15} />
          <span>Organize</span>
        </button>
        <button className={`tool-btn${group === 'redact' ? ' on' : ''}`} onClick={() => runCommand('tool.redact')}>
          <ShieldCheck size={15} />
          <span>Redact</span>
        </button>
        <button className="tool-btn" onClick={() => useUi.getState().set({ paletteOpen: true })} title={`All tools (${MOD}K)`}>
          <Wand2 size={15} />
          <span>All tools</span>
        </button>
        <span className="tb-sep" />
        <button className="icon-btn" aria-label="Find" title={`Find (${MOD}F)`} onClick={() => runCommand('edit.find')}>
          <Search size={16} />
        </button>
        <button className={`btn sm${doc.dirty ? ' primary' : ''}`} onClick={() => runCommand('file.save')} title={`Save (${MOD}S)`}>
          <Save size={14} />
          Save
        </button>
      </div>
    </div>
  )
}

/* ---------------- Contextual tool strip ---------------- */

const COMMENT_TOOLS: { tool: Tool; label: string; icon: typeof Highlighter; key?: string }[] = [
  { tool: 'highlight', label: 'Highlight text', icon: Highlighter },
  { tool: 'underline', label: 'Underline text', icon: Underline },
  { tool: 'strike', label: 'Strike through text', icon: Strikethrough },
  { tool: 'note', label: 'Sticky note', icon: StickyNote },
  { tool: 'text', label: 'Text box', icon: Type },
  { tool: 'ink', label: 'Draw', icon: Pencil },
  { tool: 'rect', label: 'Rectangle', icon: Square },
  { tool: 'ellipse', label: 'Ellipse', icon: Circle },
  { tool: 'line', label: 'Line', icon: Minus },
  { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { tool: 'stamp', label: 'Stamp', icon: Stamp },
  { tool: 'image', label: 'Image', icon: ImageIcon }
]

async function pickImage(): Promise<void> {
  const [file] = await window.api.openImages()
  if (!file) return
  const img = await imageToDataUrl(file.data)
  useUi.getState().setStyle({ pendingImage: { ...img, signature: false } })
  useUi.getState().setTool('image')
  toast.info('Click on the page to place the image, or drag to size it.')
}

function StyleControls({ doc }: { doc: Doc }): ReactNode {
  const tool = useUi((s) => s.tool)
  const style = useUi((s) => s.style)
  const selectedId = useUi((s) => s.selectedAnnot)
  const selected = doc.annots.find((a) => a.id === selectedId)
  const kind = selected?.kind ?? tool
  const color = selected?.color ?? style.color
  const width = selected?.width ?? style.width
  const fontSize = selected?.fontSize ?? style.fontSize
  const opacity = selected?.opacity ?? style.opacity
  const fill = selected ? (selected.fill ?? null) : style.fill

  const change = (patch: Partial<{ color: string; width: number; fontSize: number; opacity: number; fill: string | null }>, label: string): void => {
    useUi.getState().setStyle(patch)
    if (selected) useDocs.getState().setAnnots(doc.id, doc.annots.map((a) => (a.id === selected.id ? { ...a, ...patch } : a)), label)
  }

  if (['select', 'hand', 'redact'].includes(kind) && !selected) return null
  if (selected?.kind === 'redact' || selected?.kind === 'image') {
    return (
      <div className="strip-group">
        <button className="btn sm ghost" onClick={() => removeSelected(doc)}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    )
  }

  const showWidth = ['rect', 'ellipse', 'line', 'arrow', 'ink'].includes(kind)
  const showFont = kind === 'text'
  const showFill = ['rect', 'ellipse', 'text'].includes(kind)

  return (
    <div className="strip-group">
      <div className="swatches" role="radiogroup" aria-label="Color">
        {COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={c === color}
            aria-label={c}
            className={`swatch-btn${c.toLowerCase() === color.toLowerCase() ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => change({ color: c }, 'Change color')}
          />
        ))}
        <input type="color" aria-label="Custom color" value={color} onChange={(e) => change({ color: e.target.value }, 'Change color')} />
      </div>
      {showWidth && (
        <label className="strip-field" title="Line width">
          <span>Width</span>
          <input type="range" min={0.5} max={12} step={0.5} value={width} onChange={(e) => change({ width: Number(e.target.value) }, 'Change line width')} />
          <output>{width}</output>
        </label>
      )}
      {showFont && (
        <label className="strip-field" title="Font size">
          <span>Size</span>
          <select className="select sm" value={fontSize} onChange={(e) => change({ fontSize: Number(e.target.value) }, 'Change font size')}>
            {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((n) => (
              <option key={n} value={n}>
                {n} pt
              </option>
            ))}
          </select>
        </label>
      )}
      {showFill && (
        <label className="check strip-field" title="Fill shape">
          <input type="checkbox" checked={!!fill} onChange={(e) => change({ fill: e.target.checked ? '#ffffff' : null }, 'Change fill')} />
          <span>Fill</span>
          {fill && <input type="color" aria-label="Fill color" value={fill} onChange={(e) => change({ fill: e.target.value }, 'Change fill')} />}
        </label>
      )}
      <label className="strip-field" title="Opacity">
        <span>Opacity</span>
        <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => change({ opacity: Number(e.target.value) }, 'Change opacity')} />
      </label>
      {selected && (
        <button className="icon-btn" aria-label="Delete selected" title="Delete (⌫)" onClick={() => removeSelected(doc)}>
          <Trash2 size={15} />
        </button>
      )}
    </div>
  )
}

export function removeSelected(doc: Doc): void {
  const id = useUi.getState().selectedAnnot
  if (!id) return
  const a = doc.annots.find((x) => x.id === id)
  if (!a) return
  useDocs.getState().setAnnots(doc.id, doc.annots.filter((x) => x.id !== id), a.kind === 'redact' ? 'Remove redaction mark' : 'Delete comment')
  useUi.getState().set({ selectedAnnot: null })
}

function ToolButton(props: { tool: Tool; label: string; icon: typeof Highlighter; onClick?: () => void }): ReactNode {
  const tool = useUi((s) => s.tool)
  const Icon = props.icon
  return (
    <button
      className={`icon-btn${tool === props.tool ? ' active' : ''}`}
      aria-label={props.label}
      aria-pressed={tool === props.tool}
      title={props.label}
      onClick={props.onClick ?? (() => useUi.getState().setTool(tool === props.tool ? 'select' : props.tool))}
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  )
}

export function ToolStrip({ doc }: { doc: Doc }): ReactNode {
  const group = useUi((s) => s.toolGroup)
  const style = useUi((s) => s.style)
  const marks = doc.annots.filter((a) => a.kind === 'redact').length
  if (!group) return null

  return (
    <div className="toolstrip" role="toolbar" aria-label="Tools">
      {group === 'comment' && (
        <>
          <div className="strip-group">
            <ToolButton tool="select" label="Select" icon={MousePointer2} />
            <span className="tb-sep" />
            {COMMENT_TOOLS.map((t) =>
              t.tool === 'image' ? (
                <ToolButton key={t.tool} {...t} onClick={pickImage} />
              ) : t.tool === 'stamp' ? (
                <div key="stamp" className="split-btn">
                  <ToolButton {...t} />
                  <Menu label={<ChevronDown size={12} />} title="Choose stamp" className="icon-btn sm">
                    {(close) =>
                      STAMP_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          role="menuitem"
                          className={style.stampLabel === p.label ? 'on' : ''}
                          onClick={() => {
                            useUi.getState().setTool('stamp')
                            useUi.getState().setStyle({ stampLabel: p.label, color: p.color })
                            close()
                          }}
                        >
                          <span className="stamp-chip" style={{ color: p.color, borderColor: p.color }}>
                            {p.label}
                          </span>
                        </button>
                      ))
                    }
                  </Menu>
                </div>
              ) : (
                <ToolButton key={t.tool} {...t} />
              )
            )}
          </div>
          <StyleControls doc={doc} />
          <div className="strip-hint">{hintFor(useUi.getState().tool)}</div>
        </>
      )}

      {group === 'fillSign' && (
        <>
          <div className="strip-group">
            <ToolButton tool="select" label="Select" icon={MousePointer2} />
            <span className="tb-sep" />
            <button
              className="btn sm ghost"
              onClick={() => {
                useUi.getState().setTool('text')
                useUi.getState().setStyle({ color: '#1d2228', fill: null })
              }}
            >
              <Type size={14} /> Add text
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                useUi.getState().setTool('text')
                useUi.getState().setStyle({ color: '#1d2228', fill: null, pendingText: new Date().toLocaleDateString() })
                toast.info('Click where the date should go.')
              }}
            >
              <Calendar size={14} /> Date
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                useUi.getState().setTool('text')
                useUi.getState().setStyle({ color: '#1d2228', fill: null, pendingText: 'X', fontSize: 14 })
              }}
            >
              X mark
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                useUi.getState().setTool('ink')
                useUi.getState().setStyle({ color: '#1d2228', width: 1.5 })
              }}
            >
              <Pencil size={14} /> Draw
            </button>
            <span className="tb-sep" />
            <button className="btn sm" onClick={() => useUi.getState().openDialog('signature')}>
              <Signature size={14} /> Sign
            </button>
            <button className="btn sm ghost" onClick={() => useUi.getState().openDialog('signature', { initials: true })}>
              Initials
            </button>
          </div>
          <StyleControls doc={doc} />
          <div className="strip-hint">Type into highlighted form fields directly. Add text anywhere for forms without fields.</div>
        </>
      )}

      {group === 'redact' && (
        <>
          <div className="strip-group">
            <ToolButton tool="redact" label="Mark area for redaction" icon={SquareDashed} />
            <ToolButton tool="select" label="Select marks" icon={MousePointer2} />
            <button className="btn sm ghost" onClick={() => useUi.getState().openDialog('redactSearch')}>
              <Search size={14} /> Find text to redact
            </button>
            <span className="tb-sep" />
            <button
              className="btn sm ghost"
              disabled={!marks}
              onClick={() => useDocs.getState().setAnnots(doc.id, doc.annots.filter((a) => a.kind !== 'redact'), 'Clear redaction marks')}
            >
              <Eraser size={14} /> Clear marks
            </button>
            <button className="btn sm danger" disabled={!marks} onClick={() => applyRedactions(doc)}>
              Apply {marks || ''} redaction{marks === 1 ? '' : 's'}
            </button>
          </div>
          <StyleControls doc={doc} />
          <div className="strip-hint">Applying removes the marked content for good. Pages with redactions become flat images.</div>
        </>
      )}
    </div>
  )
}

function hintFor(tool: Tool): string {
  switch (tool) {
    case 'highlight':
    case 'underline':
    case 'strike':
      return 'Select text on the page to mark it.'
    case 'note':
      return 'Click to drop a note.'
    case 'text':
      return 'Click to add a text box, or drag to size it.'
    case 'ink':
      return 'Draw freely. Each stroke is its own comment.'
    case 'stamp':
      return 'Click to stamp, or drag to size it.'
    case 'select':
      return 'Click a comment to select it. Drag to move. Double-click text to edit.'
    default:
      return 'Drag on the page to draw.'
  }
}
