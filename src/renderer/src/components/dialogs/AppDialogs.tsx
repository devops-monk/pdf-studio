import { useEffect, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { commands } from '@/commands'
import { useDocs, viewDefaults, type Fit, type Layout } from '@/store/docs'
import { useUi, type Theme } from '@/store/ui'
import { Dialog, Segmented } from '../ui'

export function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const groups = ['File', 'Edit', 'View', 'Pages', 'Tools', 'Help'] as const
  const extra: [string, string][] = [
    ['Select tool', 'V'],
    ['Hand tool', 'H'],
    ['Pan temporarily', 'Hold Space'],
    ['Delete selected comment', '⌫'],
    ['Next / previous page', 'PgDn / PgUp'],
    ['First / last page', 'Home / End'],
    ['Zoom', `${window.api.platform === 'darwin' ? '⌘' : 'Ctrl'} + scroll`]
  ]
  return (
    <Dialog title="Keyboard shortcuts" width={640} onClose={onClose}>
      <div className="shortcut-cols">
        {groups.map((g) => {
          const list = commands.filter((c) => c.group === g && c.keys)
          if (!list.length) return null
          return (
            <section key={g}>
              <h4>{g}</h4>
              <dl className="shortcuts">
                {list.map((c) => (
                  <div key={c.id}>
                    <dt>{c.label}</dt>
                    <dd>
                      <kbd className="kbd">{c.keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
        <section>
          <h4>Viewer</h4>
          <dl className="shortcuts">
            {extra.map(([l, k]) => (
              <div key={l}>
                <dt>{l}</dt>
                <dd>
                  <kbd className="kbd">{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Dialog>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [info, setInfo] = useState<{ version: string; platform: string; arch: string } | null>(null)
  useEffect(() => {
    window.api.info().then(setInfo)
  }, [])
  return (
    <Dialog title="About PDF Studio" width={400} onClose={onClose}>
      <div className="about">
        <img src="./icon.svg" alt="" width={72} height={72} />
        <h3 className="wordmark small">
          <span className="marker">PDF</span> Studio
        </h3>
        <p className="muted">{info ? `Version ${info.version} · ${info.platform} ${info.arch}` : ''}</p>
        <p>A private PDF workbench. Your documents never leave this computer: no account, no telemetry, no cloud.</p>
      </div>
    </Dialog>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const theme = useUi((s) => s.theme)
  const [prefs, setPrefs] = useState<Record<string, unknown>>({})
  useEffect(() => {
    window.api.prefs.get().then(setPrefs)
  }, [])
  const setPref = (k: string, v: unknown): void => {
    setPrefs({ ...prefs, [k]: v })
    window.api.prefs.set(k, v)
    if (k === 'defaultFit') viewDefaults.fit = v === 'actual' ? null : (v as Fit)
    if (k === 'defaultLayout') viewDefaults.layout = v as Layout
  }
  return (
    <Dialog title="Settings" width={460} onClose={onClose}>
      <div className="field">
        <span>Appearance</span>
        <Segmented<Theme>
          value={theme}
          onChange={(t) => useUi.getState().setTheme(t)}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'Match system' }
          ]}
        />
      </div>
      <div className="field">
        <span>Open documents at</span>
        <Segmented
          value={(prefs.defaultFit as string) ?? 'width'}
          onChange={(v) => setPref('defaultFit', v)}
          options={[
            { value: 'width', label: 'Fit width' },
            { value: 'page', label: 'Fit page' },
            { value: 'actual', label: '100%' }
          ]}
        />
      </div>
      <div className="field">
        <span>Page layout</span>
        <Segmented
          value={(prefs.defaultLayout as string) ?? 'continuous'}
          onChange={(v) => setPref('defaultLayout', v)}
          options={[
            { value: 'continuous', label: 'Continuous' },
            { value: 'single', label: 'Single page' },
            { value: 'twoUp', label: 'Two pages' }
          ]}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={prefs.restoreSidebar !== false} onChange={(e) => setPref('restoreSidebar', e.target.checked)} />
        Show the page sidebar when opening documents
      </label>
    </Dialog>
  )
}

export function PasswordPrompt(): ReactNode {
  const prompt = useDocs((s) => s.passwordPrompt)
  const [pw, setPw] = useState('')
  useEffect(() => setPw(''), [prompt])
  if (!prompt) return null
  const done = (value: string | null): void => {
    prompt.resolve(value)
    useDocs.setState({ passwordPrompt: null })
  }
  return (
    <Dialog title="Password required" width={400} onClose={() => done(null)} onSubmit={() => pw && done(pw)} footer={
      <>
        <button className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button className="btn primary" disabled={!pw} onClick={() => done(pw)}>
          Open
        </button>
      </>
    }>
      <div className="row">
        <Lock size={18} className="faint" />
        <p>
          <strong>{prompt.name}</strong> is protected. Enter its password to open it.
        </p>
      </div>
      <input className={`input${prompt.incorrect ? ' invalid' : ''}`} type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
      {prompt.incorrect && <span className="field-hint error">That password is incorrect. Try again.</span>}
    </Dialog>
  )
}
