"use client"

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  AppearanceSelector,
  type AppearanceSelectorLabels,
} from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import type { IconOption } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

type AppearanceDialogProps = {
  open: boolean
  title: string
  icon: string | null
  color: string | null
  labels: AppearanceSelectorLabels
  iconSuggestions?: IconOption[]
  onIconChange: (value: string | null) => void
  onColorChange: (value: string | null) => void
  onSubmit: () => void
  onClose: () => void
  isSaving?: boolean
  errorMessage?: string | null
  primaryLabel: string
  savingLabel: string
  cancelLabel: string
  shortcutHint?: string
}

export function AppearanceDialog({
  open,
  title,
  icon,
  color,
  labels,
  iconSuggestions,
  onIconChange,
  onColorChange,
  onSubmit,
  onClose,
  isSaving = false,
  errorMessage = null,
  primaryLabel,
  savingLabel,
  cancelLabel,
  shortcutHint,
}: AppearanceDialogProps) {
  const handleSubmit = React.useCallback(() => {
    if (isSaving) return
    onSubmit()
  }, [isSaving, onSubmit])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="min-h-[70vh] sm:min-h-0 sm:max-w-md"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onClose()
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSubmit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 flex-col gap-4">
          <AppearanceSelector
            icon={icon}
            color={color}
            labels={labels}
            iconSuggestions={iconSuggestions}
            onIconChange={onIconChange}
            onColorChange={onColorChange}
            disabled={isSaving}
          />
          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className={shortcutHint ? 'inline-flex items-center gap-2' : undefined}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {savingLabel}
              </>
            ) : (
              <>
                <span>{primaryLabel}</span>
                {shortcutHint ? (
                  <span className="hidden rounded border border-border px-1 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                    {shortcutHint}
                  </span>
                ) : null}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
