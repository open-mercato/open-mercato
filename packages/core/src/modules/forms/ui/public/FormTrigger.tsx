"use client"

import * as React from 'react'
import { Button, buttonVariants } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { type VariantProps } from 'class-variance-authority'
import { EmbeddedForm, type EmbeddedFormSource } from './EmbeddedForm'

type ButtonVariant = VariantProps<typeof buttonVariants>['variant']

/**
 * Controlled open-state for the forms dialog/sheet surface (spec
 * `2026-05-21-forms-render-surfaces.md`, S5/D7). The DS `Dialog` primitive is
 * Radix-backed, so `Escape`-to-close and focus trapping come for free; this
 * hook only owns the boolean and the open/close affordances callers wire to a
 * button.
 */
export function useFormDialog() {
  const [open, setOpen] = React.useState(false)
  const openDialog = React.useCallback(() => setOpen(true), [])
  const closeDialog = React.useCallback(() => setOpen(false), [])
  return { open, openDialog, closeDialog, setOpen }
}

export type FormTriggerProps = {
  source: EmbeddedFormSource
  triggerLabel: React.ReactNode
  title?: React.ReactNode
  variant?: 'dialog'
  buttonVariant?: ButtonVariant
  onCompleted?: () => void
}

/**
 * Renders a trigger button that opens a published form inside the DS `Dialog`,
 * mounting the shared `<EmbeddedForm>` primitive. The inner `FormRunner` owns
 * its own submit affordance (including `Cmd/Ctrl+Enter`); this surface only
 * supplies the dialog container, an accessible title, and `Escape`-to-cancel
 * (delegated to the Radix dialog). Completing the form closes the dialog and
 * fires `onCompleted`.
 */
export function FormTrigger({
  source,
  triggerLabel,
  title,
  buttonVariant,
  onCompleted,
}: FormTriggerProps) {
  const t = useT()
  const { open, openDialog, closeDialog, setOpen } = useFormDialog()

  const handleCompleted = React.useCallback(() => {
    closeDialog()
    onCompleted?.()
  }, [closeDialog, onCompleted])

  const dialogTitle = title ?? t('forms.trigger.title', { fallback: 'Form' })

  return (
    <>
      <Button type="button" variant={buttonVariant} onClick={openDialog}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {open ? <EmbeddedForm source={source} onReturnHome={handleCompleted} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
