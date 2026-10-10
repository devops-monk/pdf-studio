import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { create } from 'zustand'

/* ---------------- Dialog ---------------- */

export function Dialog(props: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** Return true from onSubmit-capable dialogs to submit with Enter. */
  onSubmit?: () => void
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-x)')
    first?.focus()
    return () => prev?.focus?.()
  }, [])
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        style={{ width: props.width ?? 440 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            props.onClose()
          }
          if (e.key === 'Enter' && props.onSubmit && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault()
            props.onSubmit()
          }
        }}
      >
        <header className="dialog-head">
          <h2>{props.title}</h2>
          <button className="icon-btn sm dialog-x" onClick={props.onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="dialog-body">{props.children}</div>
        {props.footer && <footer className="dialog-foot">{props.footer}</footer>}
      </div>
    </div>
  )
}

/* ---------------- Toasts ---------------- */

export interface Toast {
  id: number
  kind: 'info' | 'ok' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

interface ToastStore {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let nextToast = 1
export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextToast++
    set({ toasts: [...get().toasts, { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 8000 : 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const toast = {
  info: (text: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'info', text, action }),
  ok: (text: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'ok', text, action }),
  error: (text: string) => useToasts.getState().push({ kind: 'error', text })
}

export function Toasts(): ReactNode {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="btn sm ghost"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ---------------- Busy overlay ---------------- */

interface BusyStore {
  label: string | null
  progress: number | null
  set: (label: string | null, progress?: number | null) => void
}
export const useBusy = create<BusyStore>((set) => ({
  label: null,
  progress: null,
  set: (label, progress = null) => set({ label, progress })
}))

/** Runs a long task behind a progress overlay and reports failures as a toast. */
export async function withBusy<T>(label: string, task: (progress: (fraction: number) => void) => Promise<T>): Promise<T | undefined> {
  const busy = useBusy.getState()
  busy.set(label, null)
  try {
    return await task((f) => useBusy.getState().set(label, f))
  } catch (err) {
    console.error(err)
    toast.error(`${label.replace(/…$/, '')} failed: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  } finally {
    useBusy.getState().set(null)
  }
}

export function BusyOverlay(): ReactNode {
  const { label, progress } = useBusy()
  if (!label) return null
  return (
    <div className="scrim busy">
      <div className="busy-card">
        <div className="busy-label">{label}</div>
        <div className="progress">
          <div
            className={progress == null ? 'progress-bar indeterminate' : 'progress-bar'}
            style={progress == null ? undefined : { width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/* ---------------- Small pieces ---------------- */

export function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className="seg" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === props.value}
          title={o.title}
          className={o.value === props.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty(props: { icon: ReactNode; title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon}</div>
      <div className="empty-title">{props.title}</div>
      {props.children && <div className="empty-body">{props.children}</div>}
    </div>
  )
}
