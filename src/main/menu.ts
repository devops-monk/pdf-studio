import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

const isMac = process.platform === 'darwin'

/**
 * Native menus only forward command ids to the renderer, which owns every
 * action. The command palette and the menus therefore always agree.
 */
export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const cmd = (id: string, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => getWindow()?.webContents.send('menu:command', id)
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              cmd('app.preferences', 'Settings…', 'Cmd+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd('file.open', 'Open…', 'CmdOrCtrl+O'),
        cmd('file.home', 'Home', 'CmdOrCtrl+Shift+H'),
        { type: 'separator' },
        cmd('file.save', 'Save', 'CmdOrCtrl+S'),
        cmd('file.saveAs', 'Save As…', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('tool.combine', 'Combine Files…'),
        cmd('tool.imagesToPdf', 'Create PDF from Images…'),
        { type: 'separator' },
        cmd('tool.exportImages', 'Export Pages as Images…'),
        cmd('tool.exportText', 'Export as Text…'),
        { type: 'separator' },
        cmd('file.properties', 'Document Properties…', 'CmdOrCtrl+D'),
        cmd('file.print', 'Print…', 'CmdOrCtrl+P'),
        { type: 'separator' },
        cmd('file.close', 'Close Document', 'CmdOrCtrl+W'),
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, cmd('app.preferences', 'Settings…', 'Ctrl+,'), { role: 'quit' } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        cmd('edit.undo', 'Undo', 'CmdOrCtrl+Z'),
        cmd('edit.redo', 'Redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        cmd('edit.find', 'Find…', 'CmdOrCtrl+F'),
        cmd('edit.findNext', 'Find Next', 'CmdOrCtrl+G'),
        cmd('edit.findPrev', 'Find Previous', 'CmdOrCtrl+Shift+G'),
        { type: 'separator' },
        cmd('app.palette', 'Search Tools and Commands…', 'CmdOrCtrl+K')
      ]
    },
    {
      label: 'View',
      submenu: [
        cmd('view.zoomIn', 'Zoom In', 'CmdOrCtrl+='),
        cmd('view.zoomOut', 'Zoom Out', 'CmdOrCtrl+-'),
        cmd('view.actualSize', 'Actual Size', 'CmdOrCtrl+0'),
        cmd('view.fitWidth', 'Fit Width', 'CmdOrCtrl+1'),
        cmd('view.fitPage', 'Fit Page', 'CmdOrCtrl+2'),
        { type: 'separator' },
        cmd('view.continuous', 'Continuous'),
        cmd('view.single', 'Single Page'),
        cmd('view.twoUp', 'Two Pages'),
        { type: 'separator' },
        cmd('view.rotateCw', 'Rotate View Clockwise', 'CmdOrCtrl+]'),
        cmd('view.rotateCcw', 'Rotate View Counterclockwise', 'CmdOrCtrl+['),
        { type: 'separator' },
        cmd('view.sidebar', 'Show/Hide Sidebar', 'CmdOrCtrl+\\'),
        cmd('view.readMode', 'Read Mode', 'CmdOrCtrl+Shift+R'),
        cmd('view.fullscreen', 'Full Screen', isMac ? 'Ctrl+Cmd+F' : 'F11'),
        { type: 'separator' },
        cmd('view.themeLight', 'Light Theme'),
        cmd('view.themeDark', 'Dark Theme'),
        cmd('view.themeSystem', 'Match System Theme'),
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        cmd('tool.organize', 'Organize Pages', 'CmdOrCtrl+Shift+O'),
        cmd('tool.comment', 'Comment', 'CmdOrCtrl+Shift+C'),
        cmd('tool.fillSign', 'Fill & Sign'),
        { type: 'separator' },
        cmd('tool.split', 'Split Document…'),
        cmd('tool.extract', 'Extract Pages…'),
        { type: 'separator' },
        cmd('tool.redact', 'Redact'),
        cmd('tool.protect', 'Protect with Password…'),
        cmd('tool.unprotect', 'Remove Password'),
        { type: 'separator' },
        cmd('tool.watermark', 'Add Watermark…'),
        cmd('tool.pageNumbers', 'Add Page Numbers…'),
        cmd('tool.compress', 'Compress…'),
        cmd('tool.ocr', 'Recognize Text (OCR)…'),
        cmd('tool.compare', 'Compare Files…')
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [])] as MenuItemConstructorOptions[]
    },
    {
      role: 'help',
      submenu: [cmd('app.shortcuts', 'Keyboard Shortcuts', 'CmdOrCtrl+/'), cmd('app.about', 'About PDF Studio')]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
