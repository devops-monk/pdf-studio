import type { ReactNode } from 'react'
import { useDocs } from '@/store/docs'
import { useUi } from '@/store/ui'
import { CombineDialog, ExtractDialog, InsertDialog, SplitDialog } from './PageDialogs'
import { CompressDialog, PageNumbersDialog, PropertiesDialog, ProtectDialog, WatermarkDialog } from './DocDialogs'
import { CompareDialog, ExportImagesDialog, ImagesToPdfDialog, OcrDialog } from './ConvertDialogs'
import { RedactSearchDialog, SignatureDialog } from './SignDialogs'
import { AboutDialog, PasswordPrompt, SettingsDialog, ShortcutsDialog } from './AppDialogs'

export function Dialogs(): ReactNode {
  const dialog = useUi((s) => s.dialog)
  const close = useUi((s) => s.closeDialog)
  const doc = useDocs((s) => s.active())
  const p = dialog?.props ?? {}

  let el: ReactNode = null
  if (dialog) {
    switch (dialog.name) {
      case 'combine':
        el = <CombineDialog onClose={close} />
        break
      case 'imagesToPdf':
        el = <ImagesToPdfDialog onClose={close} />
        break
      case 'compare':
        el = <CompareDialog onClose={close} />
        break
      case 'shortcuts':
        el = <ShortcutsDialog onClose={close} />
        break
      case 'about':
        el = <AboutDialog onClose={close} />
        break
      case 'settings':
        el = <SettingsDialog onClose={close} />
        break
      case 'signature':
        el = <SignatureDialog onClose={close} initials={!!p.initials} />
        break
      default:
        if (!doc) break
        el = {
          split: <SplitDialog doc={doc} onClose={close} />,
          extract: <ExtractDialog doc={doc} onClose={close} pages={p.pages as number[] | undefined} />,
          insert: <InsertDialog doc={doc} onClose={close} at={p.at as number | undefined} />,
          properties: <PropertiesDialog doc={doc} onClose={close} />,
          protect: <ProtectDialog doc={doc} onClose={close} />,
          watermark: <WatermarkDialog doc={doc} onClose={close} />,
          pageNumbers: <PageNumbersDialog doc={doc} onClose={close} />,
          compress: <CompressDialog doc={doc} onClose={close} />,
          exportImages: <ExportImagesDialog doc={doc} onClose={close} />,
          ocr: <OcrDialog doc={doc} onClose={close} />,
          redactSearch: <RedactSearchDialog doc={doc} onClose={close} />
        }[dialog.name as string]
    }
  }
  return (
    <>
      {el}
      <PasswordPrompt />
    </>
  )
}
