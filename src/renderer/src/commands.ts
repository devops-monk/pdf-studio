import {
  Archive,
  ArrowDownUp,
  Combine,
  FileImage,
  FileLock2,
  FileOutput,
  FileText,
  FileType2,
  GitCompareArrows,
  Hash,
  Highlighter,
  Images,
  Info,
  LayoutGrid,
  LockOpen,
  PenLine,
  Printer,
  ScanText,
  Scissors,
  SquareDashed,
  Stamp,
  type LucideIcon
} from 'lucide-react'
import { useDocs, openFiles } from './store/docs'
import { useUi } from './store/ui'
import { clampZoom } from './components/viewer/Viewer'
import { exportText, printDocument } from './core/tools'
import { removeAnnotations } from './core/ops'
import { toast, withBusy } from './components/ui'

export interface Command {
  id: string
  label: string
  group: 'File' | 'Edit' | 'View' | 'Tools' | 'Pages' | 'Help'
  keys?: string
  needsDoc?: boolean
  run: () => void | Promise<void>
}

export interface ToolCard {
  command: string
  title: string
  desc: string
  icon: LucideIcon
  section: 'Organize' | 'Review' | 'Protect' | 'Convert' | 'Optimize'
}

const isMac = window.api.platform === 'darwin'
export const MOD = isMac ? '⌘' : 'Ctrl+'
export const SHIFT = isMac ? '⇧' : 'Shift+'

const docs = useDocs.getState
const ui = useUi.getState
const active = () => docs().active()

function zoomBy(factor: number): void {
  const d = active()
  if (d) docs().setView(d.id, { scale: clampZoom(d.view.scale * factor), fit: null })
}

export async function openWithDialog(): Promise<void> {
  const files = await window.api.openPdfs({ multiple: true })
  if (files.length) {
    await openFiles(files)
    ui().set({ home: false })
  }
}

function enterGroup(group: 'comment' | 'fillSign' | 'redact'): void {
  const s = ui()
  const turningOff = s.toolGroup === group && s.mode === 'view'
  s.set({ toolGroup: turningOff ? null : group, mode: 'view', home: false })
  s.setTool(turningOff ? 'select' : group === 'redact' ? 'redact' : 'select')
}

export const commands: Command[] = [
  { id: 'file.open', label: 'Open…', group: 'File', keys: `${MOD}O`, run: openWithDialog },
  { id: 'file.home', label: 'Go to Home', group: 'File', keys: `${MOD}${SHIFT}H`, run: () => ui().set({ home: true }) },
  { id: 'file.save', label: 'Save', group: 'File', keys: `${MOD}S`, needsDoc: true, run: async () => void (await docs().save(active()!.id)) },
  { id: 'file.saveAs', label: 'Save As…', group: 'File', keys: `${MOD}${SHIFT}S`, needsDoc: true, run: async () => void (await docs().save(active()!.id, true)) },
  { id: 'file.close', label: 'Close Document', group: 'File', keys: `${MOD}W`, needsDoc: true, run: async () => void (await docs().close(active()!.id)) },
  { id: 'file.properties', label: 'Document Properties', group: 'File', keys: `${MOD}D`, needsDoc: true, run: () => ui().openDialog('properties') },
  { id: 'file.print', label: 'Print…', group: 'File', keys: `${MOD}P`, needsDoc: true, run: () => printDocument(active()!) },

  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: `${MOD}Z`, needsDoc: true, run: () => docs().undo(active()!.id) },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: isMac ? '⌘⇧Z' : 'Ctrl+Y', needsDoc: true, run: () => docs().redo(active()!.id) },
  { id: 'edit.find', label: 'Find in Document', group: 'Edit', keys: `${MOD}F`, needsDoc: true, run: () => ui().setFind({ open: true }) },
  {
    id: 'edit.findNext',
    label: 'Find Next',
    group: 'Edit',
    keys: `${MOD}G`,
    needsDoc: true,
    run: () => {
      const f = ui().find
      if (f.results.length) ui().setFind({ open: true, current: (f.current + 1) % f.results.length })
      else ui().setFind({ open: true })
    }
  },
  {
    id: 'edit.findPrev',
    label: 'Find Previous',
    group: 'Edit',
    keys: `${MOD}${SHIFT}G`,
    needsDoc: true,
    run: () => {
      const f = ui().find
      if (f.results.length) ui().setFind({ open: true, current: (f.current - 1 + f.results.length) % f.results.length })
    }
  },

  { id: 'view.zoomIn', label: 'Zoom In', group: 'View', keys: `${MOD}+`, needsDoc: true, run: () => zoomBy(1.2) },
  { id: 'view.zoomOut', label: 'Zoom Out', group: 'View', keys: `${MOD}−`, needsDoc: true, run: () => zoomBy(1 / 1.2) },
  { id: 'view.actualSize', label: 'Actual Size', group: 'View', keys: `${MOD}0`, needsDoc: true, run: () => docs().setView(active()!.id, { scale: 1, fit: null }) },
  { id: 'view.fitWidth', label: 'Fit Width', group: 'View', keys: `${MOD}1`, needsDoc: true, run: () => docs().setView(active()!.id, { fit: 'width' }) },
  { id: 'view.fitPage', label: 'Fit Page', group: 'View', keys: `${MOD}2`, needsDoc: true, run: () => docs().setView(active()!.id, { fit: 'page' }) },
  { id: 'view.continuous', label: 'Continuous Scrolling', group: 'View', needsDoc: true, run: () => docs().setView(active()!.id, { layout: 'continuous' }) },
  { id: 'view.single', label: 'Single Page', group: 'View', needsDoc: true, run: () => docs().setView(active()!.id, { layout: 'single' }) },
  { id: 'view.twoUp', label: 'Two Pages', group: 'View', needsDoc: true, run: () => docs().setView(active()!.id, { layout: 'twoUp' }) },
  {
    id: 'view.rotateCw',
    label: 'Rotate View Clockwise',
    group: 'View',
    keys: `${MOD}]`,
    needsDoc: true,
    run: () => docs().setView(active()!.id, { rotation: (active()!.view.rotation + 90) % 360 })
  },
  {
    id: 'view.rotateCcw',
    label: 'Rotate View Counterclockwise',
    group: 'View',
    keys: `${MOD}[`,
    needsDoc: true,
    run: () => docs().setView(active()!.id, { rotation: (active()!.view.rotation + 270) % 360 })
  },
  { id: 'view.sidebar', label: 'Show or Hide Sidebar', group: 'View', keys: `${MOD}\\`, run: () => ui().set({ sidebarOpen: !ui().sidebarOpen }) },
  { id: 'view.readMode', label: 'Read Mode', group: 'View', keys: `${MOD}${SHIFT}R`, needsDoc: true, run: () => ui().set({ readMode: !ui().readMode, mode: 'view' }) },
  { id: 'view.fullscreen', label: 'Full Screen', group: 'View', run: () => window.api.toggleFullscreen() },
  { id: 'view.themeLight', label: 'Theme: Light', group: 'View', run: () => ui().setTheme('light') },
  { id: 'view.themeDark', label: 'Theme: Dark', group: 'View', run: () => ui().setTheme('dark') },
  { id: 'view.themeSystem', label: 'Theme: Match System', group: 'View', run: () => ui().setTheme('system') },
  { id: 'view.thumbs', label: 'Show Page Thumbnails', group: 'View', needsDoc: true, run: () => ui().set({ sidebarOpen: true, panel: 'thumbs' }) },
  { id: 'view.outline', label: 'Show Bookmarks', group: 'View', needsDoc: true, run: () => ui().set({ sidebarOpen: true, panel: 'outline' }) },
  { id: 'view.comments', label: 'Show Comments List', group: 'View', needsDoc: true, run: () => ui().set({ sidebarOpen: true, panel: 'comments' }) },
  { id: 'view.fields', label: 'Show Form Fields', group: 'View', needsDoc: true, run: () => ui().set({ sidebarOpen: true, panel: 'fields' }) },
  { id: 'view.attachments', label: 'Show Attachments', group: 'View', needsDoc: true, run: () => ui().set({ sidebarOpen: true, panel: 'attachments' }) },
  { id: 'view.layers', label: 'Show Layers', group: 'View', needsDoc: true, run: () => ui().set({ sidebarOpen: true, panel: 'layers' }) },
  {
    id: 'view.nextPage',
    label: 'Next Page',
    group: 'View',
    needsDoc: true,
    run: () => docs().goTo(active()!.id, active()!.view.page + (active()!.view.layout === 'twoUp' ? 2 : 1))
  },
  {
    id: 'view.prevPage',
    label: 'Previous Page',
    group: 'View',
    needsDoc: true,
    run: () => docs().goTo(active()!.id, active()!.view.page - (active()!.view.layout === 'twoUp' ? 2 : 1))
  },
  { id: 'view.firstPage', label: 'First Page', group: 'View', needsDoc: true, run: () => docs().goTo(active()!.id, 0) },
  { id: 'view.lastPage', label: 'Last Page', group: 'View', needsDoc: true, run: () => docs().goTo(active()!.id, active()!.numPages - 1) },

  {
    id: 'tool.organize',
    label: 'Organize Pages',
    group: 'Pages',
    keys: `${MOD}${SHIFT}O`,
    needsDoc: true,
    run: () => {
      const s = ui()
      s.set({ mode: s.mode === 'organize' ? 'view' : 'organize', toolGroup: null, selectedPages: [], home: false })
      s.setTool('select')
    }
  },
  { id: 'tool.insert', label: 'Insert Pages', group: 'Pages', needsDoc: true, run: () => ui().openDialog('insert') },
  { id: 'tool.extract', label: 'Extract Pages', group: 'Pages', needsDoc: true, run: () => ui().openDialog('extract') },
  { id: 'tool.split', label: 'Split Document', group: 'Pages', needsDoc: true, run: () => ui().openDialog('split') },
  { id: 'tool.combine', label: 'Combine Files', group: 'Pages', run: () => ui().openDialog('combine') },
  { id: 'tool.comment', label: 'Comment', group: 'Tools', keys: `${MOD}${SHIFT}C`, needsDoc: true, run: () => enterGroup('comment') },
  { id: 'tool.fillSign', label: 'Fill & Sign', group: 'Tools', needsDoc: true, run: () => enterGroup('fillSign') },
  { id: 'tool.redact', label: 'Redact', group: 'Tools', needsDoc: true, run: () => enterGroup('redact') },
  { id: 'tool.redactSearch', label: 'Redact Text Matches…', group: 'Tools', needsDoc: true, run: () => ui().openDialog('redactSearch') },
  { id: 'tool.protect', label: 'Protect with Password', group: 'Tools', needsDoc: true, run: () => ui().openDialog('protect') },
  {
    id: 'tool.unprotect',
    label: 'Remove Password',
    group: 'Tools',
    needsDoc: true,
    run: () => {
      const d = active()!
      if (!d.protection && !d.wasEncrypted) {
        toast.info('This document has no password.')
        return
      }
      docs().patch(d.id, { protection: null, wasEncrypted: false, dirty: true })
      toast.ok('Password removed. Save to write the unprotected file.')
    }
  },
  { id: 'tool.watermark', label: 'Add Watermark', group: 'Tools', needsDoc: true, run: () => ui().openDialog('watermark') },
  { id: 'tool.pageNumbers', label: 'Add Page Numbers', group: 'Tools', needsDoc: true, run: () => ui().openDialog('pageNumbers') },
  { id: 'tool.compress', label: 'Compress', group: 'Tools', needsDoc: true, run: () => ui().openDialog('compress') },
  { id: 'tool.ocr', label: 'Recognize Text (OCR)', group: 'Tools', needsDoc: true, run: () => ui().openDialog('ocr') },
  { id: 'tool.compare', label: 'Compare Files', group: 'Tools', run: () => ui().openDialog('compare') },
  { id: 'tool.imagesToPdf', label: 'Create PDF from Images', group: 'Tools', run: () => ui().openDialog('imagesToPdf') },
  { id: 'tool.exportImages', label: 'Export Pages as Images', group: 'Tools', needsDoc: true, run: () => ui().openDialog('exportImages') },
  { id: 'tool.exportText', label: 'Export as Text', group: 'Tools', needsDoc: true, run: () => exportText(active()!) },
  { id: 'tool.signature', label: 'Add Signature', group: 'Tools', needsDoc: true, run: () => ui().openDialog('signature') },
  {
    id: 'tool.removeComments',
    label: 'Remove All Comments',
    group: 'Tools',
    needsDoc: true,
    run: async () => {
      const d = active()!
      docs().setAnnots(d.id, [], 'Remove comments')
      await withBusy('Removing comments…', () => docs().apply(d.id, 'Remove all comments', (b) => removeAnnotations(b, 'all-comments')))
    }
  },

  { id: 'app.palette', label: 'Search Tools and Commands', group: 'Help', keys: `${MOD}K`, run: () => ui().set({ paletteOpen: true }) },
  { id: 'app.shortcuts', label: 'Keyboard Shortcuts', group: 'Help', keys: `${MOD}/`, run: () => ui().openDialog('shortcuts') },
  { id: 'app.preferences', label: 'Settings', group: 'Help', keys: `${MOD},`, run: () => ui().openDialog('settings') },
  { id: 'app.about', label: 'About PDF Studio', group: 'Help', run: () => ui().openDialog('about') }
]

const byId = new Map(commands.map((c) => [c.id, c]))

export function runCommand(id: string): void {
  const c = byId.get(id)
  if (!c) return
  if (c.needsDoc && !active()) {
    toast.info('Open a PDF first.')
    return
  }
  Promise.resolve(c.run()).catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
}

export function commandKeys(id: string): string | undefined {
  return byId.get(id)?.keys
}

export const toolCatalog: ToolCard[] = [
  { command: 'tool.organize', title: 'Organize pages', desc: 'Reorder, rotate, delete and insert pages', icon: LayoutGrid, section: 'Organize' },
  { command: 'tool.combine', title: 'Combine files', desc: 'Merge several PDFs into one', icon: Combine, section: 'Organize' },
  { command: 'tool.split', title: 'Split document', desc: 'Break a PDF into smaller files', icon: Scissors, section: 'Organize' },
  { command: 'tool.extract', title: 'Extract pages', desc: 'Copy chosen pages to a new PDF', icon: FileOutput, section: 'Organize' },
  { command: 'tool.comment', title: 'Comment', desc: 'Highlight, draw, add notes and stamps', icon: Highlighter, section: 'Review' },
  { command: 'tool.fillSign', title: 'Fill & sign', desc: 'Complete forms and sign them', icon: PenLine, section: 'Review' },
  { command: 'tool.compare', title: 'Compare files', desc: 'See what changed between two PDFs', icon: GitCompareArrows, section: 'Review' },
  { command: 'tool.watermark', title: 'Watermark', desc: 'Stamp text across every page', icon: Stamp, section: 'Review' },
  { command: 'tool.pageNumbers', title: 'Page numbers', desc: 'Number pages in a header or footer', icon: Hash, section: 'Review' },
  { command: 'tool.redact', title: 'Redact', desc: 'Permanently remove sensitive content', icon: SquareDashed, section: 'Protect' },
  { command: 'tool.protect', title: 'Protect', desc: 'Require a password to open', icon: FileLock2, section: 'Protect' },
  { command: 'tool.unprotect', title: 'Remove password', desc: 'Save an unlocked copy', icon: LockOpen, section: 'Protect' },
  { command: 'file.properties', title: 'Properties', desc: 'Title, author, fonts and security', icon: Info, section: 'Protect' },
  { command: 'tool.imagesToPdf', title: 'Images to PDF', desc: 'Turn photos and scans into a PDF', icon: Images, section: 'Convert' },
  { command: 'tool.exportImages', title: 'PDF to images', desc: 'Save pages as PNG or JPEG', icon: FileImage, section: 'Convert' },
  { command: 'tool.exportText', title: 'PDF to text', desc: 'Save all text as a .txt file', icon: FileType2, section: 'Convert' },
  { command: 'tool.ocr', title: 'Recognize text', desc: 'Make scanned pages searchable', icon: ScanText, section: 'Convert' },
  { command: 'tool.compress', title: 'Compress', desc: 'Make the file smaller', icon: Archive, section: 'Optimize' },
  { command: 'file.print', title: 'Print', desc: 'Send pages to a printer', icon: Printer, section: 'Optimize' },
  { command: 'tool.insert', title: 'Insert pages', desc: 'Add blank pages or pages from a file', icon: ArrowDownUp, section: 'Organize' },
  { command: 'view.outline', title: 'Bookmarks', desc: 'Jump through the document outline', icon: FileText, section: 'Review' }
]
