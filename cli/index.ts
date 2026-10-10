/**
 * pdf-studio-cli — the PDF Studio engine from the command line.
 * Shares its document operations with the desktop app.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  addPageNumbers,
  addWatermark,
  combine,
  decrypt,
  deletePages,
  extractPages,
  groupsAt,
  groupsEvery,
  imagesToPdf,
  isEncrypted,
  openLib,
  optimize,
  parsePageRanges,
  protect,
  rotatePages,
  setInfo,
  splitDocument
} from '../src/renderer/src/core/ops'

const VERSION = '1.0.0'

const HELP = `pdf-studio-cli ${VERSION}

Usage: pdf-studio-cli <command> [options]

Commands
  info      <in.pdf>                              Pages, size, metadata, encryption (JSON)
  combine   <a.pdf> <b.pdf>… --out <out.pdf>       Merge files, one bookmark per file
  extract   <in.pdf> --pages <1-3,5> --out <out>  Copy pages to a new file
  split     <in.pdf> --every <n> | --at <5,9>  --out-dir <dir>
  rotate    <in.pdf> --pages <range> --angle <90|180|270> --out <out>
  delete    <in.pdf> --pages <range> --out <out>
  protect   <in.pdf> --password <pw> [--owner <pw>] [--no-print] [--no-copy] --out <out>
  unprotect <in.pdf> --password <pw> --out <out>
  watermark <in.pdf> --text <text> [--opacity 0.2] [--angle 45] [--size 64] [--color #c63b2f] --out <out>
  numbers   <in.pdf> [--format "Page {n} of {total}"] [--position bottom-center] --out <out>
  compress  <in.pdf> --out <out>
  meta      <in.pdf> [--title t] [--author a] [--subject s] [--keywords k] --out <out>
  images    <img…> [--page-size a4|letter|fit] --out <out.pdf>

Page ranges are one-based: "1-3, 5, 8-" (8- means 8 to the end).
`

interface Args {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parse(argv: string[]): Args {
  const out: Args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (key.startsWith('no-')) out[key] = true
      else if (next === undefined || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else out._.push(a)
  }
  return out
}

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`)
  process.exit(1)
}

const str = (a: Args, k: string, required = true): string => {
  const v = a[k]
  if (typeof v === 'string') return v
  if (required) fail(`missing --${k}`)
  return ''
}

const read = (p: string): Uint8Array => {
  try {
    return new Uint8Array(readFileSync(p))
  } catch {
    fail(`cannot read ${p}`)
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await openLib(bytes)).getPageCount()
}

async function rangeArg(bytes: Uint8Array, a: Args): Promise<number[]> {
  const n = await pageCount(bytes)
  const r = parsePageRanges(str(a, 'pages'), n)
  if (!r) fail(`invalid --pages for a ${n}-page document`)
  return r
}

function write(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes)
  process.stdout.write(`wrote ${path} (${bytes.length} bytes)\n`)
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = parse(rest)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return void process.stdout.write(HELP)
  if (cmd === '--version' || cmd === '-v') return void process.stdout.write(VERSION + '\n')
  const input = a._[0]

  switch (cmd) {
    case 'info': {
      const bytes = read(input)
      const encrypted = await isEncrypted(bytes)
      const doc = await openLib(encrypted ? await decrypt(bytes, str(a, 'password', false)) : bytes)
      const sizes = doc.getPages().map((p) => {
        const { width, height } = p.getSize()
        return `${Math.round(width)}x${Math.round(height)}${p.getRotation().angle ? ` r${p.getRotation().angle}` : ''}`
      })
      const info = {
        file: input,
        bytes: bytes.length,
        pages: doc.getPageCount(),
        encrypted,
        title: doc.getTitle() ?? null,
        author: doc.getAuthor() ?? null,
        subject: doc.getSubject() ?? null,
        creator: doc.getCreator() ?? null,
        producer: doc.getProducer() ?? null,
        formFields: doc.getForm().getFields().length,
        pageSizes: [...new Set(sizes)]
      }
      process.stdout.write(JSON.stringify(info, null, 2) + '\n')
      return
    }
    case 'combine': {
      if (a._.length < 2) fail('combine needs at least two files')
      write(str(a, 'out'), await combine(a._.map((p) => ({ name: basename(p), bytes: read(p) }))))
      return
    }
    case 'extract': {
      const bytes = read(input)
      write(str(a, 'out'), await extractPages(bytes, await rangeArg(bytes, a)))
      return
    }
    case 'split': {
      const bytes = read(input)
      const n = await pageCount(bytes)
      const groups = a.every ? groupsEvery(n, Math.max(1, parseInt(str(a, 'every'), 10))) : groupsAt(n, (parsePageRanges(str(a, 'at'), n) ?? fail('invalid --at')).filter((p) => p > 0))
      const dir = str(a, 'out-dir')
      mkdirSync(dir, { recursive: true })
      const parts = await splitDocument(bytes, groups)
      const stem = basename(input, extname(input))
      parts.forEach((p, i) => write(join(dir, `${stem}-part-${String(i + 1).padStart(String(parts.length).length, '0')}.pdf`), p))
      return
    }
    case 'rotate': {
      const bytes = read(input)
      write(str(a, 'out'), await rotatePages(bytes, await rangeArg(bytes, a), parseInt(str(a, 'angle'), 10)))
      return
    }
    case 'delete': {
      const bytes = read(input)
      write(str(a, 'out'), await deletePages(bytes, await rangeArg(bytes, a)))
      return
    }
    case 'protect': {
      write(
        str(a, 'out'),
        await protect(read(input), {
          userPassword: str(a, 'password'),
          ownerPassword: str(a, 'owner', false) || undefined,
          permissions: { printing: !a['no-print'], copying: !a['no-copy'] }
        })
      )
      return
    }
    case 'unprotect':
      write(str(a, 'out'), await decrypt(read(input), str(a, 'password')))
      return
    case 'watermark':
      write(
        str(a, 'out'),
        await addWatermark(read(input), {
          text: str(a, 'text'),
          opacity: Number(str(a, 'opacity', false) || 0.2),
          angle: Number(str(a, 'angle', false) || 45),
          fontSize: Number(str(a, 'size', false) || 64),
          color: str(a, 'color', false) || '#c63b2f',
          layout: a.tile ? 'tile' : 'center',
          pages: 'all',
          bold: true
        })
      )
      return
    case 'numbers':
      write(
        str(a, 'out'),
        await addPageNumbers(read(input), {
          format: str(a, 'format', false) || 'Page {n} of {total}',
          position: (str(a, 'position', false) || 'bottom-center') as never,
          fontSize: Number(str(a, 'size', false) || 10),
          margin: 28,
          color: '#333333',
          startAt: Number(str(a, 'start', false) || 1),
          pages: 'all'
        })
      )
      return
    case 'compress': {
      const bytes = read(input)
      const out = await optimize(bytes, { stripMetadata: true, removeComments: false })
      write(str(a, 'out'), out.length < bytes.length ? out : bytes)
      return
    }
    case 'meta':
      write(
        str(a, 'out'),
        await setInfo(read(input), {
          title: (a.title as string) ?? undefined,
          author: (a.author as string) ?? undefined,
          subject: (a.subject as string) ?? undefined,
          keywords: (a.keywords as string) ?? undefined
        })
      )
      return
    case 'images': {
      const imgs = a._.map((p) => {
        const ext = extname(p).toLowerCase()
        if (!['.png', '.jpg', '.jpeg'].includes(ext)) fail(`${p}: only PNG and JPEG images are supported here`)
        return { name: basename(p), bytes: read(p), type: (ext === '.png' ? 'png' : 'jpg') as 'png' | 'jpg' }
      })
      write(str(a, 'out'), await imagesToPdf(imgs, { pageSize: (str(a, 'page-size', false) || 'a4') as never, margin: 24 }))
      return
    }
    default:
      fail(`unknown command "${cmd}". Run pdf-studio-cli --help`)
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
