import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { buildMenu } from './menu'
import { registerFileIpc } from './files'
import { registerOcrIpc, shutdownOcr } from './ocr'
import { readSettings, writeSettings } from './settings'

const isMac = process.platform === 'darwin'
const appIcon = join(__dirname, '../../resources/icon.png')
let mainWindow: BrowserWindow | null = null
let rendererReady = false
let pendingPaths: string[] = []
let hasUnsavedChanges = false

function pdfPathsFrom(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.pdf'))
}

function deliverPaths(paths: string[]): void {
  if (paths.length === 0) return
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send('app:open-paths', paths)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    pendingPaths.push(...paths)
  }
}

function createWindow(): void {
  const settings = readSettings()
  const bounds = settings.windowBounds
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1360,
    height: bounds?.height ?? 880,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'PDF Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1f24' : '#e9ecef',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 14 } }
      : { titleBarOverlay: { color: '#00000000', symbolColor: '#8a939c', height: 44 } }),
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  if (settings.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Links inside PDFs open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      e.preventDefault()
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url)
    }
  })

  mainWindow.on('close', (e) => {
    if (!mainWindow) return
    const s = readSettings()
    s.maximized = mainWindow.isMaximized()
    if (!s.maximized) s.windowBounds = mainWindow.getBounds()
    writeSettings(s)
    if (hasUnsavedChanges) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Quit without saving'],
        defaultId: 0,
        cancelId: 0,
        message: 'Some documents have unsaved changes.',
        detail: 'If you quit now, those changes are lost.'
      })
      if (choice === 0) e.preventDefault()
      else hasUnsavedChanges = false
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('app:fullscreen', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('app:fullscreen', false))

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Development-only test driver: runs a JSON script of renderer snippets and
 * window captures, then quits. Never active in packaged builds.
 */
function driveForTesting(scriptPath: string): void {
  const steps: ({ js: string } | { wait: number } | { shot: string } | { size: [number, number] })[] = JSON.parse(
    require('node:fs').readFileSync(scriptPath, 'utf8')
  )
  ipcMain.once('app:ready', async () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const step of steps) {
      if (!mainWindow) break
      try {
        if ('wait' in step) await new Promise((r) => setTimeout(r, step.wait))
        if ('size' in step) mainWindow.setContentSize(step.size[0], step.size[1])
        if ('js' in step) {
          const out = await mainWindow.webContents.executeJavaScript(step.js, true)
          if (out !== undefined) console.log('[drive]', JSON.stringify(out))
        }
        if ('shot' in step) fs.writeFileSync(step.shot, (await mainWindow.webContents.capturePage()).toPNG())
      } catch (err) {
        console.log('[drive] error', String(err))
      }
    }
    hasUnsavedChanges = false
    app.exit(0)
  })
}

// Runs from source keep their own settings and single-instance lock, so they
// never clash with an installed copy of the app.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'PDF Studio Dev'))

// One window, one process: a second launch hands its files to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => deliverPaths(pdfPathsFrom(argv.slice(1))))

  // macOS delivers "Open With" and Finder double-clicks through this event.
  app.on('open-file', (e, path) => {
    e.preventDefault()
    deliverPaths([path])
  })

  // Windows groups taskbar buttons and notifications by this id; it must match
  // the installer's appId so the app shows its own name and icon, not Electron's.
  if (process.platform === 'win32') app.setAppUserModelId('com.devopsmonk.pdfstudio')

  app.whenReady().then(() => {
    app.setName('PDF Studio')
    // Packaged builds take the icon from the app bundle; when running from
    // source, macOS would otherwise show Electron's icon in the Dock.
    if (isMac && !app.isPackaged) app.dock?.setIcon(nativeImage.createFromPath(appIcon))
    app.setAboutPanelOptions({
      applicationName: 'PDF Studio',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2026 Abhay Pratap Singh',
      website: 'https://pdf-studio.devops-monk.com',
      iconPath: appIcon
    })
    registerFileIpc()
    registerOcrIpc()

    ipcMain.on('app:ready', () => {
      rendererReady = true
      const initial = [...pendingPaths, ...pdfPathsFrom(process.argv.slice(app.isPackaged ? 1 : 2))]
      pendingPaths = []
      if (initial.length) mainWindow?.webContents.send('app:open-paths', [...new Set(initial)])
    })
    ipcMain.on('app:set-dirty', (_e, dirty: boolean) => {
      hasUnsavedChanges = dirty
      mainWindow?.setDocumentEdited(dirty)
    })
    ipcMain.on('app:set-title', (_e, title: string) => mainWindow?.setTitle(title))
    ipcMain.on('app:toggle-fullscreen', () => {
      if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen())
    })
    ipcMain.on('app:set-theme', (_e, theme: 'light' | 'dark' | 'system') => {
      nativeTheme.themeSource = theme
      if (!isMac && mainWindow) {
        const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
        mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#aab3bc' : '#5b646d', height: 44 })
      }
    })
    ipcMain.handle('app:info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    }))

    createWindow()
    buildMenu(() => mainWindow)
    if (!app.isPackaged && process.env.PDFSTUDIO_DRIVE) driveForTesting(process.env.PDFSTUDIO_DRIVE)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
  app.on('before-quit', () => {
    shutdownOcr()
  })
}
