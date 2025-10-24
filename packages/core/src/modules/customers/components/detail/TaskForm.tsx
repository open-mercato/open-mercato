"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@/lib/i18n/context'
import type { TaskFormPayload } from './hooks/usePersonTasks'

export type TaskFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Record<string, unknown>
  onSubmit: (payload: TaskFormPayload) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
}

export function TaskForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
}: TaskFormProps) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const fields = React.useMemo<CrudField[]>(() => {
    return [
      {
        id: 'title',
        label: t('customers.people.detail.tasks.fields.title', 'Title'),
        type: 'text',
        required: true,
        placeholder: t('customers.people.detail.tasks.fields.titlePlaceholder', 'Task title'),
      },
      {
        id: 'is_done',
        label: t('customers.people.detail.tasks.fields.done', 'Mark as done'),
        type: 'checkbox',
        layout: 'half',
      },
    ]
  }, [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    return [
      {
        id: 'details',
        title: t('customers.people.detail.tasks.form.details', 'Task details'),
        column: 1,
        fields: ['title', 'is_done'],
      },
      {
        id: 'attributes',
        title: t('customers.people.detail.tasks.form.customFields', 'Task attributes'),
        column: 1,
        kind: 'customFields',
      },
    ]
  }, [t])

  const resolvedSubmitLabel =
    submitLabel ??
    (mode === 'edit'
      ? t('customers.people.detail.tasks.form.submitEdit', 'Update task (⌘/Ctrl + Enter)')
      : t('customers.people.detail.tasks.form.submitCreate', 'Save task (⌘/Ctrl + Enter)'))
  const resolvedCancelLabel = cancelLabel ?? t('customers.people.detail.tasks.cancel', 'Cancel')

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        const form = containerRef.current?.querySelector('form')
        form?.requestSubmit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    },
    [onCancel],
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const rawTitle = typeof values.title === 'string' ? values.title.trim() : ''
      if (!rawTitle.length) {
        throw new Error(t('customers.people.detail.tasks.titleRequired', 'Task name is required.'))
      }
      const base: TaskFormPayload['base'] = { title: rawTitle }
      if (typeof values.is_done === 'boolean') {
        base.is_done = values.is_done
      }
      const custom: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith('cf_')) {
          custom[key.slice(3)] = value
        }
      }
      await onSubmit({ base, custom })
    },
    [onSubmit, t],
  )

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <CrudForm
        embedded
        entityId="example:todo"
        fields={fields}
        groups={groups}
        initialValues={initialValues}
        submitLabel={resolvedSubmitLabel}
        onSubmit={handleSubmit}
        extraActions={
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {resolvedCancelLabel}
          </Button>
        }
      />
    </div>
  )
}
