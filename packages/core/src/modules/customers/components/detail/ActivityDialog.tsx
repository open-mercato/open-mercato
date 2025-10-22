"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import type { ActivityFormBaseValues, ActivityFormSubmitPayload } from './ActivityForm'
import { ActivityForm } from './ActivityForm'
import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useT } from '@/lib/i18n/context'

type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

export type ActivityDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  onOpenChange: (next: boolean) => void
  initialValues?: Partial<ActivityFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: ActivityFormSubmitPayload) => Promise<void>
  isSubmitting?: boolean
  activityTypeLabels: DictionarySelectLabels
  loadActivityOptions: () => Promise<DictionaryOption[]>
  createActivityOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption>
  titles?: {
    create?: string
    edit?: string
  }
  submitLabels?: {
    create?: string
    edit?: string
  }
  cancelLabel?: string
}

export function ActivityDialog({
  open,
  mode,
  onOpenChange,
  initialValues,
  onSubmit,
  isSubmitting,
  activityTypeLabels,
  loadActivityOptions,
  createActivityOption,
  titles,
  submitLabels,
  cancelLabel,
}: ActivityDialogProps) {
  const t = useT()

  const dialogTitle =
    mode === 'edit'
      ? titles?.edit ?? t('customers.people.detail.activities.editTitle', 'Edit activity')
      : titles?.create ?? t('customers.people.detail.activities.addTitle', 'Add activity')

  const resolvedSubmitLabel =
    mode === 'edit'
      ? submitLabels?.edit ?? t('customers.people.detail.activities.update', 'Update activity (⌘/Ctrl + Enter)')
      : submitLabels?.create ?? t('customers.people.detail.activities.save', 'Save activity (⌘/Ctrl + Enter)')

  const resolvedCancelLabel = cancelLabel ?? t('customers.people.detail.activities.cancel', 'Cancel')

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <ActivityForm
          mode={mode}
          initialValues={initialValues}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          submitLabel={resolvedSubmitLabel}
          cancelLabel={resolvedCancelLabel}
          isSubmitting={isSubmitting}
          activityTypeLabels={activityTypeLabels}
          loadActivityOptions={loadActivityOptions}
          createActivityOption={createActivityOption}
        />
      </DialogContent>
    </Dialog>
  )
}
