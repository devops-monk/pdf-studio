import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

export interface OpenedFile {
  path: string
  name: string
  data: Uint8Array
}

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

export interface OcrWord {
  text: string
  confidence: number
  x0: number
  y0: number
  x1: number
  y1: number
}

function listen<T>(channel: string, fn: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T): void => fn(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform,

  ready: (): void => ipcRenderer.send('app:ready'),
  info: (): Promise<{ version: string; platform: string; arch: string }> => ipcRenderer.invoke('app:info'),
  setDirty: (dirty: boolean): void => ipcRenderer.send('app:set-dirty', dirty),
  setTitle: (title: string): void => ipcRenderer.send('app:set-title', title),
  setTheme: (theme: 'light' | 'dark' | 'system'): void => ipcRenderer.send('app:set-theme', theme),
  toggleFullscreen: (): void => ipcRenderer.send('app:toggle-fullscreen'),

  openPdfs: (opts?: { multiple?: boolean; title?: string }): Promise<OpenedFile[]> =>
    ipcRenderer.invoke('dialog:open-pdfs', opts),
  openImages: (): Promise<OpenedFile[]> => ipcRenderer.invoke('dialog:open-images'),
  saveDialog: (opts: { defaultName: string; kind?: 'pdf' | 'png' | 'jpg' | 'txt'; title?: string }): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save', opts),
  chooseFolder: (title?: string): Promise<string | null> => ipcRenderer.invoke('dialog:choose-folder', title),
  confirm: (opts: { message: string; detail?: string; buttons: string[]; cancelId?: number }): Promise<number> =>
    ipcRenderer.invoke('dialog:confirm', opts),

  readFile: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('file:write', path, data),
  writeMany: (folder: string, files: { name: string; data: Uint8Array }[]): Promise<string[]> =>
    ipcRenderer.invoke('file:write-many', folder, files),
  exists: (path: string): Promise<boolean> => ipcRenderer.invoke('file:exists', path),
  /** Absolute path of a file dropped onto the window. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  recent: {
    list: (): Promise<RecentFile[]> => ipcRenderer.invoke('recent:list'),
    add: (path: string): Promise<void> => ipcRenderer.invoke('recent:add', path),
    remove: (path: string): Promise<void> => ipcRenderer.invoke('recent:remove', path),
    clear: (): Promise<void> => ipcRenderer.invoke('recent:clear')
  },

  prefs: {
    get: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('prefs:get'),
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('prefs:set', key, value)
  },

  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('shell:show-in-folder', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),

  ocr: (png: Uint8Array): Promise<OcrWord[]> => ipcRenderer.invoke('ocr:recognize', png),

  onOpenPaths: (fn: (paths: string[]) => void) => listen('app:open-paths', fn),
  onMenuCommand: (fn: (id: string) => void) => listen('menu:command', fn),
  onFullscreen: (fn: (on: boolean) => void) => listen('app:fullscreen', fn)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
