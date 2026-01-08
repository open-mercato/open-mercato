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
import { useT } from '@/lib/i18n/context'

type ResourceTypeFormValues = {
  id?: string
  name: string
  description?: string
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

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resourceTypes.form.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('booking.resourceTypes.form.description', 'Description'), type: 'textarea' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: ['name', 'description'] },
    { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ], [t])

  const handleSubmit = React.useCallback(async (values: ResourceTypeFormValues) => {
    if (!resourceTypeId) return
    const name = typeof values.name === 'string' ? values.name.trim() : ''
    const description = typeof values.description === 'string' && values.description.trim().length
      ? values.description.trim()
      : null
    const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
    const payload: Record<string, unknown> = {
      id: resourceTypeId,
      name,
      description,
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
          initialValues={initialValues ?? { id: resourceTypeId, name: '', description: '' }}
          isLoading={loading}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          deleteVisible
        />
      </PageBody>
    </Page>
  )
}
