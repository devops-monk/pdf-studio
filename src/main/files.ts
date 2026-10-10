import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { readSettings, writeSettings, type RecentFile } from './settings'

export interface OpenedFile {
  path: string
  name: string
  data: Uint8Array
}

const MAX_RECENT = 12

async function readOne(path: string): Promise<OpenedFile> {
  const data = await readFile(path)
  return { path, name: basename(path), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

/**
 * Writes through a temporary file in the same folder and renames it into place,
 * so a crash or full disk never leaves a half-written PDF behind.
 */
export async function atomicWrite(path: string, data: Uint8Array): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (err) {
    if (existsSync(tmp)) await unlink(tmp).catch(() => undefined)
    throw err
  }
}

function addRecent(path: string): void {
  const s = readSettings()
  const entry: RecentFile = { path, name: basename(path), openedAt: Date.now() }
  s.recent = [entry, ...s.recent.filter((r) => r.path !== path)].slice(0, MAX_RECENT)
  writeSettings(s)
  if (process.platform !== 'linux') app.addRecentDocument(path)
}

function win(e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined
}

const pdfFilter = { name: 'PDF documents', extensions: ['pdf'] }
const imageFilter = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }

export function registerFileIpc(): void {
  ipcMain.handle('dialog:open-pdfs', async (e, opts: { multiple?: boolean; title?: string } = {}) => {
    const w = win(e)
    const res = await dialog.showOpenDialog(w!, {
      title: opts.title ?? 'Open PDF',
      filters: [pdfFilter],
      properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    })
    if (res.canceled) return []
    return Promise.all(res.filePaths.map(readOne))
  })

  ipcMain.handle('dialog:open-images', async (e) => {
    const res = await dialog.showOpenDialog(win(e)!, {
      title: 'Choose images',
      filters: [imageFilter],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled) return []
    return Promise.all(res.filePaths.map(readOne))
  })

  ipcMain.handle(
    'dialog:save',
    async (e, opts: { defaultName: string; kind?: 'pdf' | 'png' | 'jpg' | 'txt'; title?: string }) => {
      const kind = opts.kind ?? 'pdf'
      const filters = {
        pdf: [pdfFilter],
        png: [{ name: 'PNG image', extensions: ['png'] }],
        jpg: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
        txt: [{ name: 'Text', extensions: ['txt'] }]
      }[kind]
      const res = await dialog.showSaveDialog(win(e)!, {
        title: opts.title ?? 'Save',
        defaultPath: opts.defaultName,
        filters
      })
      return res.canceled ? null : res.filePath
    }
  )

  ipcMain.handle('dialog:choose-folder', async (e, title?: string) => {
    const res = await dialog.showOpenDialog(win(e)!, {
      title: title ?? 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:confirm', async (e, opts: { message: string; detail?: string; buttons: string[]; cancelId?: number }) => {
    const res = await dialog.showMessageBox(win(e)!, {
      type: 'question',
      message: opts.message,
      detail: opts.detail,
      buttons: opts.buttons,
      defaultId: 0,
      cancelId: opts.cancelId ?? opts.buttons.length - 1
    })
    return res.response
  })

  ipcMain.handle('file:read', async (_e, path: string) => readOne(path))

  ipcMain.handle('file:write', async (_e, path: string, data: Uint8Array) => {
    await atomicWrite(path, data)
    addRecent(path)
    return true
  })

  /** Writes several files into one folder; existing names get " (2)", " (3)"… */
  ipcMain.handle('file:write-many', async (_e, folder: string, files: { name: string; data: Uint8Array }[]) => {
    await mkdir(folder, { recursive: true })
    const written: string[] = []
    for (const f of files) {
      let target = join(folder, f.name)
      const dot = f.name.lastIndexOf('.')
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name
      const ext = dot > 0 ? f.name.slice(dot) : ''
      for (let n = 2; existsSync(target); n++) target = join(folder, `${stem} (${n})${ext}`)
      await atomicWrite(target, f.data)
      written.push(target)
    }
    return written
  })

  ipcMain.handle('file:exists', async (_e, path: string) => {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  })

  ipcMain.handle('recent:list', () => readSettings().recent)
  ipcMain.handle('recent:add', (_e, path: string) => addRecent(path))
  ipcMain.handle('recent:remove', (_e, path: string) => {
    const s = readSettings()
    s.recent = s.recent.filter((r) => r.path !== path)
    writeSettings(s)
  })
  ipcMain.handle('recent:clear', () => {
    const s = readSettings()
    s.recent = []
    writeSettings(s)
    app.clearRecentDocuments()
  })

  ipcMain.handle('prefs:get', () => readSettings().prefs)
  ipcMain.handle('prefs:set', (_e, key: string, value: unknown) => {
    const s = readSettings()
    s.prefs[key] = value
    writeSettings(s)
  })

  ipcMain.handle('shell:show-in-folder', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https?:|^mailto:/.test(url)) return shell.openExternal(url)
  })
}
