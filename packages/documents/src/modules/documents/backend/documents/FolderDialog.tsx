"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FolderRow } from './documentsListTypes'

export type FolderDialogState = { mode: 'create'; parentFolderId: string | null } | { mode: 'rename'; folder: FolderRow }

export function FolderDialog({ state, onOpenChange, onSubmit }: {
  state: FolderDialogState | null
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  const t = useT()
  const inputId = React.useId()
  const [name, setName] = React.useState('')
  React.useEffect(() => setName(state?.mode === 'rename' ? state.folder.name : ''), [state])
  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && name.trim()) { event.preventDefault(); onSubmit(name.trim()) }
        if (event.key === 'Escape') onOpenChange(false)
      }}>
        <DialogHeader><DialogTitle>{state?.mode === 'rename' ? t('documents.folders.renameTitle') : t('documents.folders.createTitle')}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim()) }}>
          <div className="space-y-2">
            <Label htmlFor={inputId}>{t('documents.folders.name')}</Label>
            <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('documents.folders.namePlaceholder')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('documents.actions.cancel')}</Button>
            <Button type="submit" disabled={!name.trim()}>{state?.mode === 'rename' ? t('documents.folders.actions.rename') : t('documents.folders.actions.create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
