"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { DictionaryEntrySelect, type DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { toLocalDateTimeInput } from './utils'

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
}

export type ActivityFormSubmitPayload = {
  base: ActivityFormBaseValues
  custom: Record<string, unknown>
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
})

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

  const baseFields = React.useMemo<CrudField[]>(() => {
    return [
      {
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
      } as CrudField,
      {
        id: 'subject',
        label: t('customers.people.detail.activities.fields.subject'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.people.detail.activities.subjectPlaceholder', 'Add a subject (optional)'),
      } as CrudField,
      {
        id: 'body',
        label: t('customers.people.detail.activities.fields.body'),
        type: 'textarea',
        placeholder: t('customers.people.detail.activities.bodyPlaceholder', 'Describe the interaction'),
      } as CrudField,
      {
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
      } as CrudField,
    ]
  }, [activityTypeLabels, createActivityOption, dictionaryAppearanceLabels, loadActivityOptions, t])

  const baseFieldIds = React.useMemo(() => new Set(baseFields.map((field) => field.id)), [baseFields])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('customers.people.detail.activities.form.details', 'Activity details'),
      column: 1,
      fields: ['activityType', 'subject', 'occurredAt', 'body'],
    },
    {
      id: 'custom',
      title: t('customers.people.detail.activities.form.customFields', 'Custom fields'),
      column: 2,
      kind: 'customFields',
    },
  ], [t])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (pending || isSubmitting) return
      setPending(true)
      try {
        const parsed = schema.safeParse(values)
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? t('customers.people.detail.activities.error')
          throw new Error(message)
        }
        const base: ActivityFormBaseValues = {
          activityType: parsed.data.activityType,
          subject: parsed.data.subject || undefined,
          body: parsed.data.body || undefined,
          occurredAt: parsed.data.occurredAt && parsed.data.occurredAt.length
            ? new Date(parsed.data.occurredAt).toISOString()
            : undefined,
        }
        const customEntries: Record<string, unknown> = {}
        Object.entries(values).forEach(([key, value]) => {
          if (key.startsWith('cf_')) {
            customEntries[key.slice(3)] = value
            return
          }
          if (!baseFieldIds.has(key) && key !== 'id') {
            customEntries[key] = value
          }
        })
        await onSubmit({ base, custom: customEntries })
      } finally {
        setPending(false)
      }
    },
    [baseFieldIds, isSubmitting, onSubmit, pending, t],
  )

  const embeddedInitialValues = React.useMemo(() => {
    const occurredAt = toLocalDateTimeInput(initialValues?.occurredAt ?? null)

    return {
      activityType: initialValues?.activityType ?? '',
      subject: initialValues?.subject ?? '',
      body: initialValues?.body ?? '',
      occurredAt,
      ...Object.fromEntries(
        Object.entries(initialValues ?? {})
          .filter(([key]) => key.startsWith('cf_'))
          .map(([key, value]) => [key, value]),
      ),
    }
  }, [initialValues])

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
