"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@/lib/i18n/context'
import type { TaskFormPayload } from './hooks/usePersonTasks'
import { TaskForm } from './TaskForm'

export type TaskDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  onOpenChange: (next: boolean) => void
  initialValues?: Record<string, unknown>
  onSubmit: (payload: TaskFormPayload) => Promise<void>
  isSubmitting?: boolean
  contextMessage?: string
}

export function TaskDialog({ open, mode, onOpenChange, initialValues, onSubmit, isSubmitting, contextMessage }: TaskDialogProps) {
  const t = useT()

  const dialogTitle =
    mode === 'edit'
      ? t('customers.people.detail.tasks.dialog.editTitle', 'Edit task')
      : t('customers.people.detail.tasks.dialog.createTitle', 'Add task')

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleSubmit = React.useCallback(
    async (payload: TaskFormPayload) => {
      await onSubmit(payload)
      onOpenChange(false)
    },
    [onOpenChange, onSubmit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          {contextMessage ? <DialogDescription>{contextMessage}</DialogDescription> : null}
        </DialogHeader>
        <TaskForm
          mode={mode}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  )
}
