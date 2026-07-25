"use client"

import * as React from 'react'
import {
  CrudForm,
  type CrudCustomFieldRenderProps,
  type CrudField,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemLeading,
  SelectTrigger,
  SelectTriggerLeading,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  renderDictionaryColor,
  renderDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { CUSTOMER_INTERACTION_ENTITY_ID } from '../../lib/interactionCompatibility'
import type { TaskFormPayload } from './hooks/usePersonTasks'
import { normalizeCustomFieldSubmitValue } from './customFieldUtils'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'

export type TaskFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Record<string, unknown>
  onSubmit: (payload: TaskFormPayload) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
  formEntityId?: string
  /**
   * Render the rich, dictionary-backed status picker only on the canonical interactions path.
   * On the legacy path the deprecated `/api/customers/todos` bridge round-trips a task through a
   * binary done/not-done shape, so non-binary statuses cannot persist — keep the done checkbox there.
   */
  useCanonicalInteractions?: boolean
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
  useCanonicalInteractions = false,
}: TaskFormProps) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const scopeVersion = useOrganizationScopeVersion()
  const statusDictionary = useCustomerDictionary('interaction-statuses', scopeVersion)

  const statusOptions = React.useMemo<TaskStatusOption[]>(() => {
    const entries = statusDictionary.data?.entries ?? []
    if (entries.length > 0) {
      return entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      }))
    }
    // Fallback to the canonical seeded set until the dictionary loads (or for existing
    // tenants whose interaction-statuses dictionary has not been backfilled yet).
    return [
      { value: 'planned', label: t('customers.interactions.status.planned', 'Planned') },
      { value: 'in_progress', label: t('customers.interactions.status.in_progress', 'In progress') },
      { value: 'waiting', label: t('customers.interactions.status.waiting', 'Waiting / blocked') },
      { value: 'done', label: t('customers.interactions.status.done', 'Done') },
      { value: 'canceled', label: t('customers.interactions.status.canceled', 'Canceled') },
    ]
  }, [statusDictionary.data, t])

  const fields = React.useMemo<CrudField[]>(
    () => buildTaskFormFields({ useCanonicalInteractions, statusOptions, t }),
    [statusOptions, t, useCanonicalInteractions],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => buildTaskFormGroups({ useCanonicalInteractions, t }),
    [t, useCanonicalInteractions],
  )

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

  // On create, default the canonical status select to `planned` so the dropdown is never empty.
  // The legacy path has no status field (just the done checkbox), so it needs no default.
  const resolvedInitialValues = React.useMemo<Record<string, unknown> | undefined>(() => {
    if (mode !== 'create') return initialValues
    if (useCanonicalInteractions) return { status: 'planned', ...(initialValues ?? {}) }
    return initialValues
  }, [initialValues, mode, useCanonicalInteractions])

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <CrudForm
        embedded
        entityId={formEntityId}
        fields={fields}
        groups={groups}
        initialValues={resolvedInitialValues}
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

type TaskFormTranslator = (key: string, fallback?: string) => string

type TaskStatusOption = { value: string; label: string; color?: string | null; icon?: string | null }

type TaskStatusSelectProps = CrudCustomFieldRenderProps & {
  options: TaskStatusOption[]
  placeholder: string
}

// Dictionary-backed status picker that surfaces each status's icon + color (the dictionary
// "appearance") next to its label, both in the dropdown rows and the trigger. CrudForm's generic
// `select` renders label-only text, so the canonical status field uses this custom renderer instead.
function TaskStatusSelect({ id, value, setValue, disabled, options, placeholder }: TaskStatusSelectProps) {
  const stringValue = typeof value === 'string' ? value : ''
  const activeOption = options.find((option) => option.value === stringValue) ?? null
  return (
    <Select
      value={stringValue}
      onValueChange={(next) => setValue(next || undefined)}
      disabled={disabled}
    >
      <SelectTrigger id={id} data-crud-focus-target="">
        {activeOption && (activeOption.icon || activeOption.color) ? (
          <SelectTriggerLeading>
            {renderDictionaryIcon(activeOption.icon, 'h-4 w-4')}
            {renderDictionaryColor(activeOption.color, 'h-3.5 w-3.5 rounded-full')}
          </SelectTriggerLeading>
        ) : null}
        <SelectValue placeholder={placeholder}>{activeOption?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.icon || option.color ? (
              <SelectItemLeading>
                {renderDictionaryIcon(option.icon, 'h-4 w-4')}
                {renderDictionaryColor(option.color, 'h-3.5 w-3.5 rounded-full')}
              </SelectItemLeading>
            ) : null}
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function buildTaskFormFields(options: {
  useCanonicalInteractions: boolean
  statusOptions: TaskStatusOption[]
  t: TaskFormTranslator
}): CrudField[] {
  const { useCanonicalInteractions, statusOptions, t } = options
  // Canonical path: dictionary-backed rich status picker. Legacy path: the binary done checkbox,
  // because the deprecated todos bridge cannot persist non-binary statuses on read-back.
  const statusField: CrudField = useCanonicalInteractions
    ? {
        id: 'status',
        label: t('customers.people.detail.tasks.fields.status', 'Status'),
        type: 'custom',
        component: (props) => (
          <TaskStatusSelect
            {...props}
            options={statusOptions}
            placeholder={t('customers.people.detail.tasks.fields.statusPlaceholder', 'Select a status')}
          />
        ),
      }
    : {
        id: 'is_done',
        label: t('customers.people.detail.tasks.fields.done', 'Mark as done'),
        type: 'checkbox',
      }
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
    statusField,
  ]
}

export function buildTaskFormGroups(options: {
  useCanonicalInteractions: boolean
  t: TaskFormTranslator
}): CrudFormGroup[] {
  const { useCanonicalInteractions, t } = options
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
      fields: ['priority', useCanonicalInteractions ? 'status' : 'is_done'],
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
  const rawStatus = typeof values.status === 'string' ? values.status.trim() : ''
  const status = rawStatus.length ? rawStatus : undefined
  const base: TaskFormPayload['base'] = { title: rawTitle }
  if (status !== undefined) {
    base.status = status
    // Keep is_done in sync so the deprecated todos bridge (which only carries a boolean)
    // stays correct; the canonical interactions path uses base.status directly.
    base.is_done = status === 'done'
  } else if (typeof values.is_done === 'boolean') {
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
