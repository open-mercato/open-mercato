"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { DictionarySelectControl } from '@open-mercato/core/modules/dictionaries/components/DictionarySelectControl'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { TagsSection, type TagOption, type TagsSectionLabels } from '@open-mercato/ui/backend/detail'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/booking/lib/capacityUnits'
import { BOOKING_RESOURCE_FIELDSET_DEFAULT, resolveBookingResourceFieldsetCode } from '@open-mercato/core/modules/booking/lib/resourceCustomFields'

const DEFAULT_PAGE_SIZE = 100

type ResourceTypeRow = {
  id: string
  name: string
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

type ResourceTagsSectionConfig = {
  title: string
  tags: TagOption[]
  onChange: (next: TagOption[]) => void
  loadOptions: (query?: string) => Promise<TagOption[]>
  createTag: (label: string) => Promise<TagOption>
  onSave: (payload: { next: TagOption[]; added: TagOption[]; removed: TagOption[] }) => Promise<void>
  labels: TagsSectionLabels
}

export type BookingResourceFormConfig = {
  fields: CrudField[]
  groups: CrudFormGroup[]
  resolveFieldsetCode: (resourceTypeId?: string | null) => string
  resourceTypesLoaded: boolean
}

export function useBookingResourceFormConfig(options: {
  tagsSection?: ResourceTagsSectionConfig
} = {}): BookingResourceFormConfig {
  const { tagsSection } = options
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [resourceTypes, setResourceTypes] = React.useState<ResourceTypeRow[]>([])
  const [resourceTypesLoaded, setResourceTypesLoaded] = React.useState(false)
  const [capacityUnitDictionaryId, setCapacityUnitDictionaryId] = React.useState<string | null>(null)

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
      } finally {
        if (!cancelled) setResourceTypesLoaded(true)
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

  const fields = React.useMemo<CrudField[]>(() => {
    const baseFields: CrudField[] = [
      { id: 'name', label: t('booking.resources.form.fields.name', 'Name'), type: 'text', required: true },
      {
        id: 'description',
        label: t('booking.resources.form.fields.description', 'Description'),
        type: 'richtext',
        editor: 'uiw',
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
              if (setFormValue) {
                setFormValue('customFieldsetCode', resolveFieldsetCode(next || null))
              }
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
    ]

    baseFields.push({
      id: 'isActive',
      label: t('booking.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    })

    return baseFields
  }, [
    appearanceLabels,
    capacityUnitDictionaryId,
    resolveFieldsetCode,
    resourceTypes,
    t,
  ])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const baseGroups: CrudFormGroup[] = [
      {
        id: 'details',
        column: 1,
        fields: [
          'name',
          'description',
          'resourceTypeId',
          'capacity',
          'capacityUnitValue',
          'appearance',
          'isActive',
        ],
      },
      {
        id: 'custom',
        title: t('entities.customFields.title', 'Custom Attributes'),
        column: 2,
        kind: 'customFields',
      },
    ]

    if (tagsSection) {
      baseGroups.push({
        id: 'tags',
        column: 2,
        bare: true,
        component: () => (
          <TagsSection
            title={tagsSection.title}
            tags={tagsSection.tags}
            onChange={tagsSection.onChange}
            loadOptions={tagsSection.loadOptions}
            createTag={tagsSection.createTag}
            onSave={tagsSection.onSave}
            labels={tagsSection.labels}
          />
        ),
      })
    }

    return baseGroups
  }, [tagsSection, t])

  return { fields, groups, resolveFieldsetCode, resourceTypesLoaded }
}

export type BookingResourceFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  successRedirect?: string
  initialValues?: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
  formConfig: BookingResourceFormConfig
}

export function BookingResourceForm(props: BookingResourceFormProps) {
  const {
    title,
    submitLabel,
    backHref,
    cancelHref,
    successRedirect,
    initialValues,
    onSubmit,
    onDelete,
    isLoading,
    loadingMessage,
    formConfig,
  } = props

  return (
    <CrudForm
      title={title}
      backHref={backHref}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      successRedirect={successRedirect}
      fields={formConfig.fields}
      groups={formConfig.groups}
      initialValues={initialValues}
      entityId={E.booking.booking_resource}
      customFieldsetBindings={{ [E.booking.booking_resource]: { valueKey: 'customFieldsetCode' } }}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
  )
}
