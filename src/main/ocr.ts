import { app, ipcMain } from 'electron'
import { dirname, join, sep } from 'node:path'
import { createRequire } from 'node:module'
import { createWorker, type Worker } from 'tesseract.js'

export interface OcrWord {
  text: string
  confidence: number
  /** Pixel box in the submitted image, origin top-left. */
  x0: number
  y0: number
  x1: number
  y1: number
}

const require_ = createRequire(__filename)
let worker: Promise<Worker> | null = null

/** In a packaged app the language data lives in app.asar.unpacked. */
function unpacked(path: string): string {
  return app.isPackaged ? path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`) : path
}

function getWorker(): Promise<Worker> {
  if (!worker) {
    const langPath = unpacked(join(dirname(require_.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'))
    worker = createWorker('eng', 1, {
      langPath,
      gzip: true,
      cacheMethod: 'none'
    }).catch((err) => {
      worker = null
      throw err
    })
  }
  return worker
}

export function registerOcrIpc(): void {
  ipcMain.handle('ocr:recognize', async (_e, png: Uint8Array): Promise<OcrWord[]> => {
    const w = await getWorker()
    const { data } = await w.recognize(Buffer.from(png), {}, { blocks: true, text: false })
    const words: OcrWord[] = []
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const word of line.words) {
            const text = word.text.trim()
            if (!text || word.confidence < 30) continue
            words.push({ text, confidence: word.confidence, ...word.bbox })
          }
        }
      }
    }
    return words
  })
}

export function shutdownOcr(): void {
  worker?.then((w) => w.terminate()).catch(() => undefined)
  worker = null
}
