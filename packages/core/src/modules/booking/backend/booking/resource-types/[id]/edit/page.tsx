"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { extractCustomFieldValues } from '@open-mercato/core/modules/sales/components/documents/customFieldHelpers'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@/lib/i18n/context'

type ResourceTypeFormValues = {
  id?: string
  name: string
  description?: string
  appearance?: { icon?: string | null; color?: string | null }
} & Record<string, unknown>

type ResourceTypesResponse = {
  items?: Array<Record<string, unknown>>
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export default function BookingResourceTypeEditPage({ params }: { params?: { id?: string } }) {
  const resourceTypeId = params?.id ?? ''
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<ResourceTypeFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!resourceTypeId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<ResourceTypesResponse>(
          `/api/booking/resource-types?ids=${encodeURIComponent(resourceTypeId)}&page=1&pageSize=1`,
          undefined,
          { errorMessage: t('booking.resourceTypes.errors.load', 'Failed to load resource types.') },
        )
        const item = Array.isArray(payload.items) ? payload.items[0] : null
        if (!item) throw new Error('not_found')
        if (!cancelled) {
          const customValues = extractCustomFieldValues(item)
          setInitialValues({
            id: typeof item.id === 'string' ? item.id : resourceTypeId,
            name: typeof item.name === 'string' ? item.name : '',
            description: typeof item.description === 'string' ? item.description : '',
            appearance: {
              icon: typeof item.appearanceIcon === 'string'
                ? item.appearanceIcon
                : typeof item.appearance_icon === 'string'
                  ? item.appearance_icon
                  : null,
              color: typeof item.appearanceColor === 'string'
                ? item.appearanceColor
                : typeof item.appearance_color === 'string'
                  ? item.appearance_color
                  : null,
            },
            ...customValues,
          })
        }
      } catch (err) {
        console.error('booking.resource-types.load', err)
        if (!cancelled) setError(t('booking.resourceTypes.errors.load', 'Failed to load resource types.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [resourceTypeId, t])

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
    { id: 'description', label: t('booking.resourceTypes.form.description', 'Description'), type: 'textarea' },
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

  const handleSubmit = React.useCallback(async (values: ResourceTypeFormValues) => {
    if (!resourceTypeId) return
    const name = typeof values.name === 'string' ? values.name.trim() : ''
    const description = typeof values.description === 'string' && values.description.trim().length
      ? values.description.trim()
      : null
    const appearance = values.appearance && typeof values.appearance === 'object' ? values.appearance as { icon?: string | null; color?: string | null } : {}
    const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
    const payload: Record<string, unknown> = {
      id: resourceTypeId,
      name,
      description,
      appearanceIcon: appearance.icon ?? null,
      appearanceColor: appearance.color ?? null,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    await updateCrud('booking/resource-types', payload, {
      errorMessage: t('booking.resourceTypes.errors.save', 'Failed to save resource type.'),
    })
    flash(t('booking.resourceTypes.messages.saved', 'Resource type saved.'), 'success')
    router.push('/backend/booking/resource-types')
  }, [resourceTypeId, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!resourceTypeId) return
    await deleteCrud('booking/resource-types', resourceTypeId, {
      errorMessage: t('booking.resourceTypes.errors.delete', 'Failed to delete resource type.'),
    })
    flash(t('booking.resourceTypes.messages.deleted', 'Resource type deleted.'), 'success')
    router.push('/backend/booking/resource-types')
  }, [resourceTypeId, router, t])

  return (
    <Page>
      <PageBody>
        {error ? (
          <div className="mb-4 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <CrudForm<ResourceTypeFormValues>
          title={t('booking.resourceTypes.form.editTitle', 'Edit resource type')}
          backHref="/backend/booking/resource-types"
          cancelHref="/backend/booking/resource-types"
          submitLabel={t('booking.resourceTypes.form.save', 'Save')}
          fields={fields}
          groups={groups}
          entityId={E.booking.booking_resource_type}
          initialValues={initialValues ?? { id: resourceTypeId, name: '', description: '', appearance: { icon: null, color: null } }}
          isLoading={loading}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          deleteVisible
        />
      </PageBody>
    </Page>
  )
}
