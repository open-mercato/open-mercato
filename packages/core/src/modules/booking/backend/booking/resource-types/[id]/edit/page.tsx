"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { extractCustomFieldValues } from '@open-mercato/core/modules/sales/components/documents/customFieldHelpers'
import { buildResourceTypePayload, ResourceTypeCrudForm, type ResourceTypeFormValues } from '@open-mercato/core/modules/booking/components/ResourceTypeCrudForm'
import { useT } from '@/lib/i18n/context'

type ResourceTypesResponse = {
  items?: Array<Record<string, unknown>>
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

  const handleSubmit = React.useCallback(async (values: ResourceTypeFormValues) => {
    if (!resourceTypeId) return
    const payload = buildResourceTypePayload(values, { id: resourceTypeId })
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
          <ErrorMessage label={error} />
        ) : null}
        <ResourceTypeCrudForm
          mode="edit"
          initialValues={initialValues ?? { id: resourceTypeId, name: '', description: '', appearance: { icon: null, color: null } }}
          isLoading={loading}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
        />
      </PageBody>
    </Page>
  )
}
