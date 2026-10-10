import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'
export type Panel = 'thumbs' | 'outline' | 'comments' | 'fields' | 'attachments' | 'layers'
export type Mode = 'view' | 'organize'
export type ToolGroup = 'comment' | 'fillSign' | 'redact' | null
export type Tool =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'note'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'stamp'
  | 'image'
  | 'redact'

export type DialogName =
  | 'combine'
  | 'split'
  | 'extract'
  | 'insert'
  | 'properties'
  | 'protect'
  | 'watermark'
  | 'pageNumbers'
  | 'compress'
  | 'imagesToPdf'
  | 'exportImages'
  | 'ocr'
  | 'compare'
  | 'signature'
  | 'shortcuts'
  | 'about'
  | 'settings'
  | 'redactSearch'

export interface ToolStyle {
  color: string
  opacity: number
  width: number
  fontSize: number
  fill: string | null
  stampLabel: string
  /** Text placed by the next text box (e.g. today's date from Fill & Sign). */
  pendingText: string
  /** Image or signature waiting to be placed with the image tool. */
  pendingImage: { dataUrl: string; width: number; height: number; signature: boolean } | null
}

export interface FindState {
  open: boolean
  query: string
  matchCase: boolean
  wholeWord: boolean
  /** Every match: page and the character offsets in that page's text. */
  results: { page: number; start: number; end: number }[]
  current: number
  searching: boolean
}

interface UiStore {
  theme: Theme
  home: boolean
  mode: Mode
  sidebarOpen: boolean
  panel: Panel
  toolGroup: ToolGroup
  tool: Tool
  style: ToolStyle
  selectedAnnot: string | null
  find: FindState
  dialog: { name: DialogName; props?: Record<string, unknown> } | null
  paletteOpen: boolean
  readMode: boolean
  fullscreen: boolean
  selectedPages: number[]
  /** Optional-content (layer) visibility overrides per document. */
  authorName: string

  set: (patch: Partial<UiStore>) => void
  setStyle: (patch: Partial<ToolStyle>) => void
  setFind: (patch: Partial<FindState>) => void
  openDialog: (name: DialogName, props?: Record<string, unknown>) => void
  closeDialog: () => void
  setTool: (tool: Tool) => void
  setTheme: (theme: Theme) => void
}

export const TOOL_COLORS: Partial<Record<Tool, string>> = {
  highlight: '#f5c518',
  underline: '#2a62b8',
  strike: '#c63b2f',
  note: '#f5c518',
  text: '#1d2228',
  rect: '#c63b2f',
  ellipse: '#c63b2f',
  line: '#2a62b8',
  arrow: '#c63b2f',
  ink: '#1d2228',
  stamp: '#2f7d4f'
}

export const useUi = create<UiStore>((set, get) => ({
  theme: 'system',
  home: true,
  mode: 'view',
  sidebarOpen: true,
  panel: 'thumbs',
  toolGroup: null,
  tool: 'select',
  style: {
    color: '#f5c518',
    opacity: 1,
    width: 2,
    fontSize: 14,
    fill: null,
    stampLabel: 'APPROVED',
    pendingText: '',
    pendingImage: null
  },
  selectedAnnot: null,
  find: { open: false, query: '', matchCase: false, wholeWord: false, results: [], current: -1, searching: false },
  dialog: null,
  paletteOpen: false,
  readMode: false,
  fullscreen: false,
  selectedPages: [],
  authorName: '',

  set: (patch) => set(patch),
  setStyle: (patch) => set({ style: { ...get().style, ...patch } }),
  setFind: (patch) => set({ find: { ...get().find, ...patch } }),
  openDialog: (name, props) => set({ dialog: { name, props }, paletteOpen: false }),
  closeDialog: () => set({ dialog: null }),
  setTool: (tool) => {
    const color = TOOL_COLORS[tool]
    const opacity = tool === 'highlight' ? 1 : get().style.opacity
    set({
      tool,
      selectedAnnot: null,
      style: { ...get().style, ...(color ? { color } : {}), opacity, width: tool === 'ink' ? 2.5 : get().style.width }
    })
  },
  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    window.api.setTheme(theme)
    window.api.prefs.set('theme', theme)
  }
}))

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

media.addEventListener('change', () => applyTheme(useUi.getState().theme))
