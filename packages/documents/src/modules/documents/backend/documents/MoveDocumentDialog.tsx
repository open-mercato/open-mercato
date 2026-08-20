"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DocumentRow, FolderRow } from './documentsListTypes'

const ROOT_VALUE = '__documents_root__'

export function MoveDocumentDialog({ document, folders, open, onOpenChange, onMove }: {
  document: DocumentRow | null
  folders: FolderRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMove: (document: DocumentRow, folderId: string | null) => Promise<boolean | void>
}) {
  const t = useT()
  const [value, setValue] = React.useState(ROOT_VALUE)
  const [saving, setSaving] = React.useState(false)
  const writableFolders = React.useMemo(() => folders.filter((folder) => folder.canEdit), [folders])
  React.useEffect(() => {
    if (document && open) setValue(document.folderId ?? ROOT_VALUE)
  }, [document, open])
  const submit = React.useCallback(async () => {
    if (!document || saving || (document.folderId ?? ROOT_VALUE) === value) return
    setSaving(true)
    try {
      const result = await onMove(document, value === ROOT_VALUE ? null : value)
      if (result !== false) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [document, onMove, onOpenChange, saving, value])
  const onKeyDown = useDialogKeyHandler({
    onConfirm: () => { if (!saving) void submit() },
    onCancel: () => { if (!saving) onOpenChange(false) },
  })
  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!saving) onOpenChange(nextOpen)
  }, [onOpenChange, saving])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('documents.folders.moveDocument.title')}</DialogTitle>
          <DialogDescription>{t('documents.folders.moveDocument.description', { title: document?.title ?? '' })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="documents-move-folder">{t('documents.columns.folder')}</Label>
          <Select value={value} onValueChange={setValue} disabled={saving}>
            <SelectTrigger id="documents-move-folder"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ROOT_VALUE}>{t('documents.folders.root')}</SelectItem>
              {writableFolders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('documents.actions.cancel')}</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || !document || (document.folderId ?? ROOT_VALUE) === value}>{t('documents.folders.actions.moveDocument')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
