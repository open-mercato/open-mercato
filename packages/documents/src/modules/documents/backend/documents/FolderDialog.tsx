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
  onSubmit: (name: string) => boolean | void | Promise<boolean | void>
}) {
  const t = useT()
  const inputId = React.useId()
  const [name, setName] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  React.useEffect(() => setName(state?.mode === 'rename' ? state.folder.name : ''), [state])

  const submit = React.useCallback(async () => {
    const nextName = name.trim()
    if (!nextName || isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await onSubmit(nextName)
      // Preserve the legacy void callback contract while allowing callers to
      // keep the dialog open by returning false after a handled failure.
      if (result !== false) onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }, [isSubmitting, name, onOpenChange, onSubmit])

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (!isSubmitting) onOpenChange(open)
  }, [isSubmitting, onOpenChange])

  return (
    <Dialog open={state !== null} onOpenChange={handleOpenChange}>
      <DialogContent onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && name.trim() && !isSubmitting) { event.preventDefault(); void submit() }
        if (event.key === 'Escape' && !isSubmitting) onOpenChange(false)
      }}>
        <DialogHeader><DialogTitle>{state?.mode === 'rename' ? t('documents.folders.renameTitle') : t('documents.folders.createTitle')}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="space-y-2">
            <Label htmlFor={inputId}>{t('documents.folders.name')}</Label>
            <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('documents.folders.namePlaceholder')} disabled={isSubmitting} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t('documents.actions.cancel')}</Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>{state?.mode === 'rename' ? t('documents.folders.actions.rename') : t('documents.folders.actions.create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
