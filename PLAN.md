# PDF Studio — build plan

A private, offline PDF workbench for macOS, Windows and Linux (Ubuntu, Fedora, …).
Feature set modelled on `../pdfcraft` (read its README for reference), but written
from scratch with a different stack and architecture. No code is copied.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Shell | Electron + electron-vite | One codebase → dmg / exe / AppImage / deb / rpm |
| UI | React 19 + TypeScript + zustand | Component UI, small global store |
| Rendering, text, search, forms | `pdfjs-dist` | Mature renderer with text & annotation layers |
| Editing, encryption | `@cantoo/pdf-lib` | pdf-lib fork with AES-256 encrypt/decrypt |
| OCR | `tesseract.js` + bundled English data | Runs fully offline, in the main process |
| Fonts | IBM Plex (bundled via @fontsource) | Offline, no network calls |

## Architecture

- **Main process** (`src/main`): windows, native menus, file dialogs, read/write
  files (atomic writes), recent files, OS "open with" / file associations, OCR worker.
- **Preload** (`src/preload`): a narrow, typed `window.api` bridge (contextIsolation on).
- **Renderer** (`src/renderer`):
  - `core/` — pure document logic: `pdf.ts` (pdf.js loading/rendering), `ops.ts`
    (page ops, combine, split, watermark, numbers, protect, redact, compress…),
    `annots.ts` (writes overlay annotations as real PDF annotations with appearance streams).
  - `store/` — open documents (tabs), each with working bytes, undo/redo history,
    pending annotations, dirty flag.
  - `components/` — title bar + tabs, toolbar, sidebar panels, viewer, organize
    grid, dialogs, command palette, home screen.

Every edit produces new bytes and pushes the previous state on the undo stack, so
undo/redo is uniform for page ops, annotations and tools.

## Steps

### Phase 1 — Foundation
- [ ] 1. Project scaffold: electron-vite config, tsconfig, folders, `npm run dev` opens a window
- [ ] 2. Main process: window, menus, open/save dialogs, atomic save, recent files, open-with/argv, single instance
- [ ] 3. Preload bridge with typed API
- [ ] 4. Design system: tokens (light/dark), Plex fonts, base components (button, icon button, dialog, toast, field)

### Phase 2 — Reading
- [ ] 5. Document store: tabs, open from dialog / drag & drop / recent, dirty dot, close prompt
- [ ] 6. Viewer: lazy page rendering, zoom (in/out/fit width/fit page), continuous / single / two-up, rotate view
- [ ] 7. Text layer (select & copy) and link/annotation layer (existing comments, links, form widgets)
- [ ] 8. Find bar: search as you type, highlight all matches, next/previous (⌘G / ⇧⌘G)
- [ ] 9. Sidebar: thumbnails, bookmarks (with filter), attachments (save), comments list, form fields
- [ ] 10. Password-protected PDFs: prompt, decrypt to working copy, keep encryption on save
- [ ] 11. Read mode / full screen, light & dark theme, keyboard shortcuts
- [ ] 12. Home screen: open, recent files, tool catalogue; command palette (⌘K)

### Phase 3 — Organize
- [ ] 13. Undo/redo history with labels (“Undo Rotate pages”)
- [ ] 14. Organize grid: select (click / ⌘ / ⇧), drag to reorder, rotate, delete, duplicate, insert blank, insert from file, extract
- [ ] 15. Combine files (bookmark per file, reorderable list)
- [ ] 16. Split (every n pages / at chosen pages / by bookmarks) and extract to new files

### Phase 4 — Comment & fill
- [ ] 17. Annotation tools: highlight / underline / strike-through (from text selection), sticky note, text box, rectangle, ellipse, line, arrow, freehand ink, stamp, image
- [ ] 18. Select, move, recolour and delete pending annotations; written as real PDF annotations on save
- [ ] 19. Fill & sign: fill forms (values baked in on save), signature pad (draw / type / image), saved signatures

### Phase 5 — Tools
- [ ] 20. Document properties: view & edit title/author/subject/keywords; version, page sizes, fonts, security
- [ ] 21. Protect: add password (AES-256) with permissions; remove password
- [ ] 22. Redact: mark areas or search terms, apply (burned in — content under the box is removed)
- [ ] 23. Watermark (text, opacity, angle, position) and header/footer page numbers
- [ ] 24. Compress / optimise (object streams, strip metadata, optional image downsampling)
- [ ] 25. Convert: images → PDF, PDF → PNG/JPEG, PDF → text
- [ ] 26. OCR: make scanned pages searchable (invisible text layer)
- [ ] 27. Compare two PDFs: side by side with visual diff highlighting
- [ ] 28. Print

### Phase 6 — Ship
- [ ] 29. CLI (`pdf-studio-cli`): info, combine, split, extract, rotate, protect
- [ ] 30. App icon and electron-builder config: mac (dmg, x64+arm64), Windows (nsis + portable, x64+arm64), Linux (AppImage, deb, rpm)
- [ ] 31. README: install, develop, build for each OS
- [ ] 32. Verification: typecheck, production build, smoke-test core ops with a script, packaged build for this machine

## Status log

(Updated as steps complete.)
