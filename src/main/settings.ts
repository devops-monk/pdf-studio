import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

export interface Settings {
  windowBounds?: { x: number; y: number; width: number; height: number }
  maximized?: boolean
  recent: RecentFile[]
  /** Renderer-owned preferences (theme, saved signatures, view defaults…). */
  prefs: Record<string, unknown>
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

export function readSettings(): Settings {
  try {
    if (existsSync(file())) {
      const parsed = JSON.parse(readFileSync(file(), 'utf8'))
      return { recent: [], prefs: {}, ...parsed }
    }
  } catch {
    // A corrupt settings file is replaced by defaults rather than blocking startup.
  }
  return { recent: [], prefs: {} }
}

export function writeSettings(s: Settings): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, file())
}
