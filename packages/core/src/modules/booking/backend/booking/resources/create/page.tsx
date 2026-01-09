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
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/booking/lib/capacityUnits'
import { BOOKING_RESOURCE_FIELDSET_DEFAULT, resolveBookingResourceFieldsetCode } from '@open-mercato/core/modules/booking/lib/resourceCustomFields'

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

  const resourceFieldsetByTypeId = React.useMemo(() => {
    const map = new Map<string, string>()
    resourceTypes.forEach((type) => {
      map.set(type.id, resolveBookingResourceFieldsetCode(type.name))
    })
    return map
  }, [resourceTypes])

  const resolveFieldsetCode = React.useCallback((resourceTypeId?: string | null) => {
    if (!resourceTypeId) return BOOKING_RESOURCE_FIELDSET_DEFAULT
    return resourceFieldsetByTypeId.get(resourceTypeId) ?? BOOKING_RESOURCE_FIELDSET_DEFAULT
  }, [resourceFieldsetByTypeId])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('booking.resources.form.appearance.colorLabel', 'Color'),
    colorHelp: t('booking.resources.form.appearance.colorHelp', 'Pick a color for this resource.'),
    colorClearLabel: t('booking.resources.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('booking.resources.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('booking.resources.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('booking.resources.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('booking.resources.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('booking.resources.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('booking.resources.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('booking.resources.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('booking.resources.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resources.form.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'description',
      label: t('booking.resources.form.fields.description', 'Description'),
      type: 'richtext',
      editor: 'markdown',
    },
    {
      id: 'resourceTypeId',
      label: t('booking.resources.form.fields.type', 'Resource type'),
      type: 'custom',
      component: ({ value, setValue, setFormValue }) => (
        <select
          className="w-full h-9 rounded border px-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            const next = event.target.value || ''
            setValue(next)
            setFormValue('customFieldsetCode', resolveFieldsetCode(next || null))
          }}
          data-crud-focus-target=""
        >
          <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
          {resourceTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      ),
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
      id: 'appearance',
      label: t('booking.resources.form.appearance.label', 'Appearance'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        const appearance = value && typeof value === 'object'
          ? value as { icon?: string | null; color?: string | null }
          : {}
        return (
          <AppearanceSelector
            icon={appearance.icon ?? null}
            color={appearance.color ?? null}
            onIconChange={(next) => setValue({ ...appearance, icon: next })}
            onColorChange={(next) => setValue({ ...appearance, color: next })}
            labels={appearanceLabels}
            disabled={disabled}
          />
        )
      },
    },
    {
      id: 'isAvailableByDefault',
      label: t('booking.resources.form.fields.defaultAvailability', 'Available by default'),
      description: t(
        'booking.resources.form.fields.defaultAvailability.help',
        'When unchecked, this resource is unavailable unless you add availability rules.',
      ),
      type: 'checkbox',
    },
    {
      id: 'isActive',
      label: t('booking.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [appearanceLabels, capacityUnitDictionaryId, resolveFieldsetCode, resourceTypes, t])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const appearance = values.appearance && typeof values.appearance === 'object'
      ? values.appearance as { icon?: string | null; color?: string | null }
      : {}
    const { appearance: _appearance, customFieldsetCode: _customFieldsetCode, ...rest } = values
    const payload: Record<string, unknown> = {
      ...rest,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      appearanceIcon: appearance.icon ?? null,
      appearanceColor: appearance.color ?? null,
      isActive: values.isActive ?? true,
      isAvailableByDefault: values.isAvailableByDefault ?? true,
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
          initialValues={{
            description: '',
            isActive: true,
            isAvailableByDefault: true,
            capacityUnitValue: '',
            appearance: { icon: null, color: null },
            customFieldsetCode: BOOKING_RESOURCE_FIELDSET_DEFAULT,
          }}
          entityId={E.booking.booking_resource}
          customFieldsetBindings={{ [E.booking.booking_resource]: { valueKey: 'customFieldsetCode' } }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
