"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { DictionarySelectControl } from '@open-mercato/core/modules/dictionaries/components/DictionarySelectControl'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/booking/lib/capacityUnits'

const DEFAULT_PAGE_SIZE = 200

type ResourceTypeRow = {
  id: string
  name: string
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

export default function BookingResourceCreatePage() {
  const t = useT()
  const router = useRouter()
  const [resourceTypes, setResourceTypes] = React.useState<ResourceTypeRow[]>([])
  const [capacityUnitDictionaryId, setCapacityUnitDictionaryId] = React.useState<string | null>(null)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    let cancelled = false
    async function loadResourceTypes() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: String(DEFAULT_PAGE_SIZE) })
        const call = await apiCall<ResourceTypesResponse>(`/api/booking/resource-types?${params.toString()}`)
        if (!cancelled) {
          const items = Array.isArray(call.result?.items) ? call.result.items : []
          setResourceTypes(items)
        }
      } catch {
        if (!cancelled) setResourceTypes([])
      }
    }
    loadResourceTypes()
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    async function loadCapacityUnitDictionary() {
      try {
        const call = await apiCall<{ items?: Array<{ id?: string; key?: string; isInherited?: boolean }> }>('/api/dictionaries')
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const matches = items.filter((item) => item?.key === BOOKING_CAPACITY_UNIT_DICTIONARY_KEY)
        const preferred = matches.find((item) => item?.isInherited === false) ?? matches[0] ?? null
        if (!cancelled) setCapacityUnitDictionaryId(preferred?.id ?? null)
      } catch {
        if (!cancelled) setCapacityUnitDictionaryId(null)
      }
    }
    loadCapacityUnitDictionary()
    return () => { cancelled = true }
  }, [scopeVersion])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resources.form.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'resourceTypeId',
      label: t('booking.resources.form.fields.type', 'Resource type'),
      type: 'select',
      options: resourceTypes.map((type) => ({ value: type.id, label: type.name })),
    },
    {
      id: 'capacity',
      label: t('booking.resources.form.fields.capacity', 'Capacity'),
      description: t(
        'booking.resources.form.fields.capacity.help',
        'Depends on the resource and can mean spots, units, quantity, or another type of capacity.',
      ),
      type: 'number',
    },
    {
      id: 'capacityUnitValue',
      label: t('booking.resources.form.fields.capacityUnit', 'Capacity unit'),
      type: 'custom',
      component: ({ value, setValue }) => {
        if (!capacityUnitDictionaryId) {
          return (
            <p className="text-xs text-muted-foreground">
              {t('booking.resources.form.fields.capacityUnit.missing', 'Capacity unit dictionary is not configured.')}
            </p>
          )
        }
        return (
          <DictionarySelectControl
            dictionaryId={capacityUnitDictionaryId}
            value={typeof value === 'string' ? value : null}
            onChange={(next) => setValue(next ?? '')}
            selectClassName="w-full"
          />
        )
      },
    },
    {
      id: 'isActive',
      label: t('booking.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [capacityUnitDictionaryId, resourceTypes, t])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {
      ...values,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      isActive: values.isActive ?? true,
      ...collectCustomFieldValues(values),
    }
    if (!payload.name || String(payload.name).trim().length === 0) {
      throw createCrudFormError(t('booking.resources.form.errors.nameRequired', 'Name is required.'))
    }
    const { result } = await createCrud<{ id?: string }>('booking/resources', payload, {
      errorMessage: t('booking.resources.form.errors.create', 'Failed to create resource.'),
    })
    const resourceId = result?.id
    if (resourceId) {
      flash(t('booking.resources.form.flash.created', 'Resource created.'), 'success')
      router.push(`/backend/booking/resources/${encodeURIComponent(resourceId)}`)
      return
    }
    flash(t('booking.resources.form.flash.created', 'Resource created.'), 'success')
    router.push('/backend/booking/resources')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('booking.resources.form.createTitle', 'Create resource')}
          backHref="/backend/booking/resources"
          cancelHref="/backend/booking/resources"
          submitLabel={t('booking.resources.form.actions.create', 'Create')}
          fields={fields}
          initialValues={{ isActive: true, capacityUnitValue: '' }}
          entityId={E.booking.booking_resource}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
