"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { DictionaryEntrySelect, type DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { E } from '@open-mercato/generated/entity-ids'
import { toLocalDateTimeInput } from './utils'
import { normalizeCustomFieldSubmitValue } from './customFieldUtils'

type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

export type ActivityFormBaseValues = {
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  dealId?: string | null
}

export type ActivityFormSubmitPayload = {
  base: ActivityFormBaseValues
  custom: Record<string, unknown>
  entityId?: string | null
}

export type ActivityFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Partial<ActivityFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: ActivityFormSubmitPayload) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
  activityTypeLabels: DictionarySelectLabels
  loadActivityOptions: () => Promise<DictionaryOption[]>
  createActivityOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption>
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
}

const schema = z.object({
  activityType: z.string().min(1),
  subject: z.string().transform((value) => value.trim()).optional(),
  body: z.string().transform((value) => value.trim()).optional(),
  occurredAt: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => {
      if (!value) return true
      const parsed = new Date(value)
      return !Number.isNaN(parsed.getTime())
    }, { message: 'customers.people.detail.activities.invalidDate' })
    .optional(),
}).passthrough()

const ACTIVITY_ENTITY_IDS = [E.customers.customer_activity]

export function ActivityForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
  activityTypeLabels,
  loadActivityOptions,
  createActivityOption,
  dealOptions,
  entityOptions,
  defaultEntityId,
}: ActivityFormProps) {
  const t = useT()
  const [pending, setPending] = React.useState(false)

  const dictionaryAppearanceLabels = React.useMemo(
    () => ({
      colorLabel: t('customers.config.dictionaries.dialog.colorLabel', 'Color'),
      colorHelp: t('customers.config.dictionaries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
      colorClearLabel: t('customers.config.dictionaries.dialog.colorClear', 'Remove color'),
      iconLabel: t('customers.config.dictionaries.dialog.iconLabel', 'Icon or emoji'),
      iconPlaceholder: t('customers.config.dictionaries.dialog.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
      iconPickerTriggerLabel: t('customers.config.dictionaries.dialog.iconBrowse', 'Browse icons and emojis'),
      iconSearchPlaceholder: t('customers.config.dictionaries.dialog.iconSearchPlaceholder', 'Search icons or emojis…'),
      iconSearchEmptyLabel: t('customers.config.dictionaries.dialog.iconSearchEmpty', 'No icons match your search.'),
      iconSuggestionsLabel: t('customers.config.dictionaries.dialog.iconSuggestions', 'Suggestions'),
      iconClearLabel: t('customers.config.dictionaries.dialog.iconClear', 'Remove icon'),
      previewEmptyLabel: t('customers.config.dictionaries.dialog.previewEmpty', 'No appearance selected'),
    }),
    [t],
  )

  const normalizedDealOptions = React.useMemo(() => {
    if (!Array.isArray(dealOptions)) return []
    const seen = new Set<string>()
    return dealOptions
      .map((option) => {
        if (!option || typeof option !== 'object') return null
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (!id || seen.has(id)) return null
        const label =
          typeof option.label === 'string' && option.label.trim().length
            ? option.label.trim()
            : id
        seen.add(id)
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => !!option)
  }, [dealOptions])

  const normalizedEntityOptions = React.useMemo(() => {
    if (!Array.isArray(entityOptions)) return []
    const seen = new Set<string>()
    return entityOptions
      .map((option) => {
        if (!option || typeof option !== 'object') return null
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (!id || seen.has(id)) return null
        const label =
          typeof option.label === 'string' && option.label.trim().length
            ? option.label.trim()
            : id
        seen.add(id)
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => !!option)
  }, [entityOptions])

  const baseFields = React.useMemo<CrudField[]>(() => {
    const fields: CrudField[] = []

    if (normalizedEntityOptions.length) {
      fields.push({
        id: 'entityId',
        label: t('customers.people.detail.activities.fields.entity', 'Assign to customer'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue }) => {
          const currentValue =
            typeof value === 'string' && value.length ? value : normalizedEntityOptions[0]?.id ?? ''
          return (
            <select
              className="h-9 w-full rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={currentValue}
              onChange={(event) => setValue(event.target.value)}
            >
              {normalizedEntityOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        },
      } as CrudField)
    }

    if (normalizedDealOptions.length) {
      fields.push({
        id: 'dealId',
        label: t('customers.people.detail.activities.fields.deal', 'Link to deal (optional)'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' ? value : ''
          return (
            <select
              className="h-9 w-full rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={currentValue}
              onChange={(event) => setValue(event.target.value)}
            >
              <option value="">
                {t('customers.people.detail.activities.fields.dealPlaceholder', 'No linked deal')}
              </option>
              {normalizedDealOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        },
      } as CrudField)
    }

    fields.push({
      id: 'activityType',
      label: t('customers.people.detail.activities.fields.type'),
      type: 'custom',
      required: true,
      layout: 'half',
      component: ({ value, setValue }) => (
        <DictionaryEntrySelect
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next ?? '')}
          fetchOptions={loadActivityOptions}
          createOption={createActivityOption}
          labels={activityTypeLabels}
          allowAppearance
          allowInlineCreate
          appearanceLabels={dictionaryAppearanceLabels}
          selectClassName="w-full"
          manageHref="/backend/config/customers"
        />
      ),
    } as CrudField)

    fields.push({
      id: 'subject',
      label: t('customers.people.detail.activities.fields.subject'),
      type: 'text',
      layout: 'half',
      placeholder: t('customers.people.detail.activities.subjectPlaceholder', 'Add a subject (optional)'),
    } as CrudField)

    fields.push({
      id: 'body',
      label: t('customers.people.detail.activities.fields.body'),
      type: 'textarea',
      placeholder: t('customers.people.detail.activities.bodyPlaceholder', 'Describe the interaction'),
    } as CrudField)

    fields.push({
      id: 'occurredAt',
      label: t('customers.people.detail.activities.fields.occurredAt'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <input
          type="datetime-local"
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => setValue(event.target.value || '')}
          onFocus={(event) => {
            const target = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
            if (typeof target.showPicker === 'function') {
              try { target.showPicker() } catch { /* ignore unsupported */ }
            }
          }}
          onClick={(event) => {
            const target = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
            if (typeof target.showPicker === 'function') {
              try { target.showPicker() } catch { /* ignore unsupported */ }
            }
          }}
        />
      ),
      layout: 'half',
    } as CrudField)

    return fields
  }, [
    activityTypeLabels,
    createActivityOption,
    dictionaryAppearanceLabels,
    loadActivityOptions,
    normalizedDealOptions,
    normalizedEntityOptions,
    t,
  ])

  const baseFieldIds = React.useMemo(() => new Set(baseFields.map((field) => field.id)), [baseFields])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const detailFields: string[] = []
    if (normalizedEntityOptions.length) detailFields.push('entityId')
    if (normalizedDealOptions.length) detailFields.push('dealId')
    detailFields.push('activityType', 'subject', 'occurredAt', 'body')
    return [
      {
        id: 'details',
        title: t('customers.people.detail.activities.form.details', 'Activity details'),
        column: 1,
        fields: detailFields,
      },
      {
        id: 'custom',
        title: t('customers.people.detail.activities.form.customFields', 'Custom fields'),
        column: 2,
        kind: 'customFields',
      },
    ]
  }, [normalizedDealOptions.length, normalizedEntityOptions.length, t])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (pending || isSubmitting) return
      setPending(true)
      try {
        const parsed = schema.safeParse(values)
        if (!parsed.success) {
          throw buildActivityValidationError(parsed.error.issues, t)
        }
        const rawEntityId = typeof values.entityId === 'string' ? values.entityId.trim() : ''
        const resolvedEntityId = rawEntityId || (typeof defaultEntityId === 'string' ? defaultEntityId : '')
        const rawDealId = typeof values.dealId === 'string' ? values.dealId.trim() : ''
        const base: ActivityFormBaseValues = {
          activityType: parsed.data.activityType,
          subject: parsed.data.subject || undefined,
          body: parsed.data.body || undefined,
          occurredAt: parsed.data.occurredAt && parsed.data.occurredAt.length
            ? new Date(parsed.data.occurredAt).toISOString()
            : undefined,
          dealId: rawDealId.length ? rawDealId : undefined,
        }
        const reservedCustomKeys = new Set(['entityId', 'dealId'])
        const customEntries = collectCustomFieldValues(values, {
          transform: (value) => normalizeCustomFieldSubmitValue(value),
          accept: (fieldId) => !reservedCustomKeys.has(fieldId),
        })
        Object.entries(values).forEach(([key, value]) => {
          if (key.startsWith('cf_')) return
          if (!baseFieldIds.has(key) && key !== 'id') {
            if (reservedCustomKeys.has(key)) return
            customEntries[key] = normalizeCustomFieldSubmitValue(value)
          }
        })
        await onSubmit({ base, custom: customEntries, entityId: resolvedEntityId.length ? resolvedEntityId : undefined })
      } finally {
        setPending(false)
      }
    },
    [baseFieldIds, defaultEntityId, isSubmitting, onSubmit, pending, t],
  )

  const embeddedInitialValues = React.useMemo(() => {
    const occurredAt = toLocalDateTimeInput(initialValues?.occurredAt ?? null)
    const resolvedEntity = (() => {
      const raw = typeof (initialValues as Record<string, unknown> | undefined)?.entityId === 'string'
        ? (initialValues as Record<string, unknown>).entityId as string
        : typeof defaultEntityId === 'string'
          ? defaultEntityId
          : normalizedEntityOptions[0]?.id ?? ''
      return raw ?? ''
    })()
    const resolvedDeal = typeof (initialValues as Record<string, unknown> | undefined)?.dealId === 'string'
      ? (initialValues as Record<string, unknown>).dealId as string
      : ''

    return {
      entityId: resolvedEntity,
      dealId: resolvedDeal,
      activityType: initialValues?.activityType ?? '',
      subject: initialValues?.subject ?? '',
      body: initialValues?.body ?? '',
      occurredAt,
      ...Object.fromEntries(
        Object.entries(initialValues ?? {})
          .filter(([key]) => {
            if (!key.startsWith('cf_')) return false
            const trimmed = key.slice(3)
            return trimmed !== 'entityId' && trimmed !== 'dealId'
          })
          .map(([key, value]) => [key, value]),
      ),
    }
  }, [defaultEntityId, initialValues, normalizedEntityOptions])

  return (
    <CrudForm<Record<string, unknown>>
      embedded
      fields={baseFields}
      groups={groups}
      initialValues={embeddedInitialValues}
      onSubmit={handleSubmit}
      submitLabel={submitLabel ?? (mode === 'edit'
        ? t('customers.people.detail.activities.update', 'Update activity (⌘/Ctrl + Enter)')
        : t('customers.people.detail.activities.save', 'Save activity (⌘/Ctrl + Enter)'))}
      extraActions={(
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending || isSubmitting}
        >
          {cancelLabel ?? t('customers.people.detail.activities.cancel', 'Cancel')}
        </Button>
      )}
      entityIds={ACTIVITY_ENTITY_IDS}
    />
  )
}

export function buildActivityValidationError(issues: z.ZodIssue[], t: (key: string, fallback?: string) => string) {
  const issue = issues[0]
  const message = issue?.message ?? t('customers.people.detail.activities.error')
  const firstPath = Array.isArray(issue?.path) ? issue?.path?.[0] : undefined
  const field = typeof firstPath === 'string' ? firstPath : undefined
  throw createCrudFormError(message, field ? { [field]: message } : undefined)
}
