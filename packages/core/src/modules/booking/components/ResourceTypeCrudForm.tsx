"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@/lib/i18n/context'

export type ResourceTypeFormValues = {
  id?: string
  name: string
  description?: string
  appearance?: { icon?: string | null; color?: string | null }
} & Record<string, unknown>

type ResourceTypeCrudFormProps = {
  mode: 'create' | 'edit'
  initialValues: ResourceTypeFormValues
  isLoading?: boolean
  onSubmit: (values: ResourceTypeFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  deleteVisible?: boolean
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export const buildResourceTypePayload = (
  values: ResourceTypeFormValues,
  options: { id?: string } = {},
): Record<string, unknown> => {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  const description = typeof values.description === 'string' && values.description.trim().length
    ? values.description.trim()
    : null
  const appearance = values.appearance && typeof values.appearance === 'object'
    ? values.appearance as { icon?: string | null; color?: string | null }
    : {}
  const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })

  return {
    ...(options.id ? { id: options.id } : {}),
    name,
    description,
    appearanceIcon: appearance.icon ?? null,
    appearanceColor: appearance.color ?? null,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function ResourceTypeCrudForm({
  mode,
  initialValues,
  isLoading,
  onSubmit,
  onDelete,
  deleteVisible,
}: ResourceTypeCrudFormProps) {
  const t = useT()

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('booking.resourceTypes.form.appearance.colorLabel', 'Color'),
    colorHelp: t('booking.resourceTypes.form.appearance.colorHelp', 'Pick a color for this resource type.'),
    colorClearLabel: t('booking.resourceTypes.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('booking.resourceTypes.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('booking.resourceTypes.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('booking.resourceTypes.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('booking.resourceTypes.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('booking.resourceTypes.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('booking.resourceTypes.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('booking.resourceTypes.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('booking.resourceTypes.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resourceTypes.form.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('booking.resourceTypes.form.description', 'Description'), type: 'richtext' },
    {
      id: 'appearance',
      label: t('booking.resourceTypes.form.appearance.label', 'Appearance'),
      type: 'custom',
      component: ({ value, setValue }) => {
        const current = value && typeof value === 'object' ? (value as { icon?: string | null; color?: string | null }) : {}
        return (
          <AppearanceSelector
            icon={current.icon ?? null}
            color={current.color ?? null}
            onIconChange={(next) => setValue({ ...current, icon: next })}
            onColorChange={(next) => setValue({ ...current, color: next })}
            labels={appearanceLabels}
          />
        )
      },
    },
  ], [appearanceLabels, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description', 'appearance'] },
    { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ], [t])

  return (
    <CrudForm<ResourceTypeFormValues>
      title={mode === 'create'
        ? t('booking.resourceTypes.form.createTitle', 'Add resource type')
        : t('booking.resourceTypes.form.editTitle', 'Edit resource type')}
      backHref="/backend/booking/resource-types"
      cancelHref="/backend/booking/resource-types"
      submitLabel={t('booking.resourceTypes.form.save', 'Save')}
      fields={fields}
      groups={groups}
      entityId={E.booking.booking_resource_type}
      initialValues={initialValues}
      isLoading={isLoading}
      onSubmit={onSubmit}
      onDelete={mode === 'edit' ? onDelete : undefined}
      deleteVisible={typeof deleteVisible === 'boolean' ? deleteVisible : mode === 'edit'}
    />
  )
}
