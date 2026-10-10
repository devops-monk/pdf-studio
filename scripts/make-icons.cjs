// Rasterises build/icon.svg with Chromium (via Electron) into every icon size
// the installers need. Run: npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const full = image.resize({ width: 1024, height: 1024, quality: 'best' })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), full.toPNG())
  fs.mkdirSync(path.join(root, 'build', 'icons'), { recursive: true })
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
    fs.writeFileSync(path.join(root, 'build', 'icons', `${s}x${s}.png`), full.resize({ width: s, height: s, quality: 'best' }).toPNG())
  }
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), full.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  console.log('icons written')
  app.quit()
})
