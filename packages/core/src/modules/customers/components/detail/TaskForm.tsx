"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CUSTOMER_INTERACTION_ENTITY_ID } from '../../lib/interactionCompatibility'
import type { TaskFormPayload } from './hooks/usePersonTasks'
import { normalizeCustomFieldSubmitValue } from './customFieldUtils'

export type TaskFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Record<string, unknown>
  onSubmit: (payload: TaskFormPayload) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
  formEntityId?: string
}

export function TaskForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
  formEntityId = CUSTOMER_INTERACTION_ENTITY_ID,
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
        id: 'scheduledAt',
        label: t('customers.people.detail.tasks.fields.scheduledAt', 'Scheduled for'),
        type: 'datetime',
        placeholder: t('customers.people.detail.tasks.fields.scheduledAtPlaceholder', 'Choose a date and time'),
      },
      {
        id: 'priority',
        label: t('customers.people.detail.tasks.fields.priority', 'Priority'),
        type: 'number',
        placeholder: t('customers.people.detail.tasks.fields.priorityPlaceholder', '0-100'),
      },
      {
        id: 'description',
        label: t('customers.people.detail.tasks.fields.description', 'Description'),
        type: 'textarea',
        placeholder: t('customers.people.detail.tasks.fields.descriptionPlaceholder', 'Add context, outcome, or follow-up notes'),
        layout: 'full',
      },
      {
        id: 'is_done',
        label: t('customers.people.detail.tasks.fields.done', 'Mark as done'),
        type: 'checkbox',
      },
    ]
  }, [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    return [
      {
        id: 'details',
        title: t('customers.people.detail.tasks.form.details', 'Task details'),
        column: 1,
        fields: ['title', 'scheduledAt', 'description'],
      },
      {
        id: 'status',
        title: t('customers.people.detail.tasks.form.status', 'Status'),
        column: 2,
        fields: ['priority', 'is_done'],
      },
      {
        id: 'attributes',
        title: t('customers.people.detail.tasks.form.customFields', 'Task attributes'),
        column: 1,
        kind: 'customFields',
      },
      {
        id: 'tips',
        title: t('customers.people.detail.tasks.form.tips', 'Tips'),
        column: 2,
        component: () => (
          <div className="text-sm text-muted-foreground">
            {t(
              'customers.people.detail.tasks.form.tipsBody',
              'Tasks save independently from the main customer form. Use clear titles like "Follow up call" or "Send pricing deck".',
            )}
          </div>
        ),
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
      const payload = buildTaskSubmitPayload(values, t)
      await onSubmit(payload)
    },
    [onSubmit, t],
  )

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <CrudForm
        embedded
        entityId={formEntityId}
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

export function buildTaskSubmitPayload(values: Record<string, unknown>, t: (key: string, fallback?: string) => string): TaskFormPayload {
  const rawTitle = typeof values.title === 'string' ? values.title.trim() : ''
  if (!rawTitle.length) {
    const message = t('customers.people.detail.tasks.titleRequired', 'Task name is required.')
    throw createCrudFormError(message, { title: message })
  }

  const rawPriority = typeof values.priority === 'number' || typeof values.priority === 'string' ? values.priority : null
  let priority: number | null = null
  if (rawPriority !== null && rawPriority !== '') {
    const parsed = typeof rawPriority === 'number' ? rawPriority : Number(String(rawPriority).trim())
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      const message = t('customers.people.detail.tasks.priorityInvalid', 'Enter a whole-number priority between 0 and 100.')
      throw createCrudFormError(message, { priority: message })
    }
    priority = parsed
  }

  const rawDescription = typeof values.description === 'string' ? values.description.trim() : ''
  const rawScheduledAt = typeof values.scheduledAt === 'string' ? values.scheduledAt.trim() : ''
  const base: TaskFormPayload['base'] = { title: rawTitle }
  if (typeof values.is_done === 'boolean') {
    base.is_done = values.is_done
  }
  base.description = rawDescription || null
  base.priority = priority
  base.scheduledAt = rawScheduledAt || null
  const custom = collectCustomFieldValues(values, {
    transform: (value) => normalizeCustomFieldSubmitValue(value),
  })
  return { base, custom }
}
