import { create } from 'zustand'
import { loadPdf, PasswordRequired, type PDFDocumentProxy, closePdf } from '@/core/pdf'
import { decrypt, isEncrypted, protect, type Permissions } from '@/core/ops'
import { writeAnnotations } from '@/core/annots'
import type { Annot } from '@/core/types'
import { uid } from '@/core/types'
import { toast } from '@/components/ui'

export type Layout = 'continuous' | 'single' | 'twoUp'
export type Fit = 'width' | 'page' | null

export interface ViewState {
  scale: number
  fit: Fit
  layout: Layout
  /** Extra rotation applied only on screen (not saved). */
  rotation: number
  /** Zero-based page currently in view. */
  page: number
}

interface Snapshot {
  bytes: Uint8Array
  annots: Annot[]
  label: string
}

export interface Doc {
  id: string
  name: string
  path: string | null
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  numPages: number
  /** Increments whenever the bytes change, so views know to re-render. */
  version: number
  /** Encryption applied when saving: the original's, or one set with Protect. */
  protection: Protection | null
  /** The file on disk was encrypted when opened. */
  wasEncrypted: boolean
  annots: Annot[]
  past: Snapshot[]
  future: Snapshot[]
  dirty: boolean
  view: ViewState
  /** Navigation requests from panels/commands to the viewer. */
  scrollTo: { page: number; nonce: number } | null
}

export interface Protection {
  userPassword: string
  ownerPassword?: string
  permissions?: Partial<Permissions>
}

const HISTORY_LIMIT = 40

interface DocStore {
  docs: Doc[]
  activeId: string | null
  /** Pending password prompt for a file being opened. */
  passwordPrompt: null | { name: string; incorrect: boolean; resolve: (pw: string | null) => void }

  active: () => Doc | undefined
  get: (id: string) => Doc | undefined
  setActive: (id: string | null) => void
  open: (file: { name: string; path: string | null; data: Uint8Array }) => Promise<Doc | undefined>
  close: (id: string) => Promise<boolean>
  patch: (id: string, patch: Partial<Doc>) => void
  setView: (id: string, view: Partial<ViewState>) => void
  goTo: (id: string, page: number) => void

  /** Runs an operation on committed bytes and records it for undo. */
  apply: (id: string, label: string, op: (bytes: Uint8Array) => Promise<Uint8Array>) => Promise<boolean>
  /** Replaces the annotation list, recording the previous list for undo. */
  setAnnots: (id: string, annots: Annot[], label: string) => void
  /** Updates annotations without recording history (live dragging). */
  setAnnotsLive: (id: string, annots: Annot[]) => void
  /** Records the current state as an undo step (before a live drag begins). */
  checkpoint: (id: string, label: string) => void
  undo: (id: string) => Promise<void>
  redo: (id: string) => Promise<void>

  /** Bytes with typed form values and pending annotations written in (not encrypted). */
  committed: (id: string) => Promise<Uint8Array>
  /** Bytes as they should be written to disk: committed, then encrypted if protected. */
  output: (id: string) => Promise<Uint8Array>
  save: (id: string, saveAs?: boolean) => Promise<boolean>
}

/** How new documents open; updated from Settings. */
export const viewDefaults: { fit: Fit; layout: Layout } = { fit: 'width', layout: 'continuous' }

const defaultView = (): ViewState => ({ scale: 1, fit: viewDefaults.fit, layout: viewDefaults.layout, rotation: 0, page: 0 })

function syncWindow(docs: Doc[], activeId: string | null): void {
  window.api.setDirty(docs.some((d) => d.dirty))
  const d = docs.find((x) => x.id === activeId)
  window.api.setTitle(d ? `${d.dirty ? '• ' : ''}${d.name} — PDF Studio` : 'PDF Studio')
}

function askPassword(name: string, incorrect: boolean): Promise<string | null> {
  return new Promise((resolve) => useDocs.setState({ passwordPrompt: { name, incorrect, resolve } }))
}

/** Form values typed into the page live in pdf.js until saved into the bytes. */
async function withFormValues(doc: Doc): Promise<Uint8Array> {
  const storage = doc.pdf.annotationStorage
  if (storage.size === 0) return doc.bytes
  return new Uint8Array(await doc.pdf.saveDocument())
}

export const useDocs = create<DocStore>((set, get) => {
  const replaceDoc = (id: string, fn: (d: Doc) => Doc): void => {
    const docs = get().docs.map((d) => (d.id === id ? fn(d) : d))
    set({ docs })
    syncWindow(docs, get().activeId)
  }

  const watchForms = (id: string, pdf: PDFDocumentProxy): void => {
    ;(pdf.annotationStorage as unknown as { onSetModified: () => void }).onSetModified = () => replaceDoc(id, (d) => ({ ...d, dirty: true }))
  }

  /** Loads new bytes as the document's content, keeping the old proxy until the new one is ready. */
  const swapBytes = async (
    id: string,
    bytes: Uint8Array,
    annots: Annot[],
    history: Pick<Doc, 'past' | 'future'>,
    preloaded?: PDFDocumentProxy
  ): Promise<void> => {
    const old = get().get(id)
    if (!old) return
    const pdf = preloaded ?? (await loadPdf(bytes))
    watchForms(id, pdf)
    replaceDoc(id, (d) => ({
      ...d,
      bytes,
      pdf,
      numPages: pdf.numPages,
      version: d.version + 1,
      annots,
      ...history,
      dirty: true,
      view: { ...d.view, page: Math.min(d.view.page, pdf.numPages - 1) }
    }))
    setTimeout(() => closePdf(old.pdf), 1000)
  }

  return {
    docs: [],
    activeId: null,
    passwordPrompt: null,

    active: () => get().docs.find((d) => d.id === get().activeId),
    get: (id) => get().docs.find((d) => d.id === id),

    setActive: (id) => {
      set({ activeId: id })
      syncWindow(get().docs, id)
    },

    open: async ({ name, path, data }) => {
      const existing = path ? get().docs.find((d) => d.path === path) : undefined
      if (existing) {
        get().setActive(existing.id)
        return existing
      }
      let password: string | undefined
      let pdf: PDFDocumentProxy
      let bytes = data
      for (;;) {
        try {
          pdf = await loadPdf(bytes, password)
          break
        } catch (err) {
          if (err instanceof PasswordRequired) {
            const pw = await askPassword(name, err.incorrect)
            set({ passwordPrompt: null })
            if (pw === null) return undefined
            password = pw
            continue
          }
          toast.error(`${name} could not be opened: ${err instanceof Error ? err.message : String(err)}`)
          return undefined
        }
      }

      // Work on a decrypted copy; the original encryption is restored on save.
      let encrypted = false
      try {
        encrypted = await isEncrypted(bytes)
        if (encrypted) {
          bytes = await decrypt(bytes, password ?? '')
          await closePdf(pdf)
          pdf = await loadPdf(bytes)
        }
      } catch (err) {
        console.warn('Decrypting for editing failed; the document is read-only for edits.', err)
      }

      const id = uid()
      watchForms(id, pdf)
      const doc: Doc = {
        id,
        name,
        path,
        bytes,
        pdf,
        numPages: pdf.numPages,
        version: 1,
        protection: encrypted && password ? { userPassword: password } : null,
        wasEncrypted: encrypted,
        annots: [],
        past: [],
        future: [],
        dirty: false,
        view: defaultView(),
        scrollTo: null
      }
      set({ docs: [...get().docs, doc], activeId: id })
      syncWindow(get().docs, id)
      if (path) window.api.recent.add(path)
      return doc
    },

    close: async (id) => {
      const doc = get().get(id)
      if (!doc) return true
      if (doc.dirty) {
        const choice = await window.api.confirm({
          message: `Save changes to “${doc.name}” before closing?`,
          detail: 'Your changes are lost if you don’t save them.',
          buttons: ['Save', 'Don’t Save', 'Cancel'],
          cancelId: 2
        })
        if (choice === 2) return false
        if (choice === 0 && !(await get().save(id))) return false
      }
      const docs = get().docs
      const index = docs.findIndex((d) => d.id === id)
      const rest = docs.filter((d) => d.id !== id)
      const nextActive = get().activeId === id ? (rest[Math.min(index, rest.length - 1)]?.id ?? null) : get().activeId
      set({ docs: rest, activeId: nextActive })
      syncWindow(rest, nextActive)
      closePdf(doc.pdf)
      return true
    },

    patch: (id, patch) => replaceDoc(id, (d) => ({ ...d, ...patch })),
    setView: (id, view) => replaceDoc(id, (d) => ({ ...d, view: { ...d.view, ...view } })),
    goTo: (id, page) =>
      replaceDoc(id, (d) => ({
        ...d,
        view: { ...d.view, page: Math.max(0, Math.min(page, d.numPages - 1)) },
        scrollTo: { page: Math.max(0, Math.min(page, d.numPages - 1)), nonce: Date.now() + Math.random() }
      })),

    apply: async (id, label, op) => {
      const doc = get().get(id)
      if (!doc) return false
      try {
        // Commit what lives outside the bytes (typed form values, pending
        // annotations) so the operation sees the document as the user does.
        let base = await withFormValues(doc)
        const keep = doc.annots.filter((a) => a.kind === 'redact')
        base = await writeAnnotations(base, doc.annots)
        const next = await op(base)
        const past = [...doc.past, { bytes: doc.bytes, annots: doc.annots, label }].slice(-HISTORY_LIMIT)
        const fresh = await loadPdf(next)
        const pagesSame = fresh.numPages === doc.numPages
        await swapBytes(id, next, pagesSame ? keep : [], { past, future: [] }, fresh)
        return true
      } catch (err) {
        console.error(err)
        toast.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    },

    setAnnots: (id, annots, label) =>
      replaceDoc(id, (d) => ({
        ...d,
        annots,
        past: [...d.past, { bytes: d.bytes, annots: d.annots, label }].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true
      })),

    setAnnotsLive: (id, annots) => replaceDoc(id, (d) => ({ ...d, annots, dirty: true })),

    checkpoint: (id, label) =>
      replaceDoc(id, (d) => ({
        ...d,
        past: [...d.past, { bytes: d.bytes, annots: d.annots, label }].slice(-HISTORY_LIMIT),
        future: []
      })),

    undo: async (id) => {
      const doc = get().get(id)
      const step = doc?.past.at(-1)
      if (!doc || !step) return
      const past = doc.past.slice(0, -1)
      const future = [{ bytes: doc.bytes, annots: doc.annots, label: step.label }, ...doc.future]
      if (step.bytes === doc.bytes) replaceDoc(id, (d) => ({ ...d, annots: step.annots, past, future, dirty: true }))
      else await swapBytes(id, step.bytes, step.annots, { past, future })
      toast.info(`Undid ${step.label.toLowerCase()}`)
    },

    redo: async (id) => {
      const doc = get().get(id)
      const step = doc?.future[0]
      if (!doc || !step) return
      const future = doc.future.slice(1)
      const past = [...doc.past, { bytes: doc.bytes, annots: doc.annots, label: step.label }]
      if (step.bytes === doc.bytes) replaceDoc(id, (d) => ({ ...d, annots: step.annots, past, future, dirty: true }))
      else await swapBytes(id, step.bytes, step.annots, { past, future })
      toast.info(`Redid ${step.label.toLowerCase()}`)
    },

    committed: async (id) => {
      const doc = get().get(id)!
      return writeAnnotations(await withFormValues(doc), doc.annots)
    },

    output: async (id) => {
      const doc = get().get(id)!
      const bytes = await get().committed(id)
      return doc.protection ? protect(bytes, doc.protection) : bytes
    },

    save: async (id, saveAs = false) => {
      const doc = get().get(id)
      if (!doc) return false
      if (doc.annots.some((a) => a.kind === 'redact')) {
        toast.info('Redaction marks are not saved until you apply them (Redact → Apply).')
      }
      let path = doc.path
      if (!path || saveAs) {
        path = await window.api.saveDialog({ defaultName: doc.name.toLowerCase().endsWith('.pdf') ? doc.name : `${doc.name}.pdf`, title: 'Save PDF' })
        if (!path) return false
      }
      try {
        const bytes = await get().output(id)
        await window.api.writeFile(path, bytes)
        const name = path.split(/[\\/]/).pop() ?? doc.name
        replaceDoc(id, (d) => ({ ...d, path, name, dirty: false }))
        toast.ok(`Saved ${name}`)
        return true
      } catch (err) {
        toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    }
  }
})

/** Opens raw files (from dialogs, drops, recent list or the OS). */
export async function openFiles(files: { name: string; path: string | null; data: Uint8Array }[]): Promise<void> {
  for (const f of files) await useDocs.getState().open(f)
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      const file = await window.api.readFile(p)
      await useDocs.getState().open(file)
    } catch {
      toast.error(`Could not open ${p.split(/[\\/]/).pop()}. It may have been moved or deleted.`)
      window.api.recent.remove(p)
    }
  }
}
