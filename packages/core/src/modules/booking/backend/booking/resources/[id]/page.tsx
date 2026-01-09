"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { TagsSection, type TagOption } from '@open-mercato/ui/backend/detail'
import { DictionarySelectControl } from '@open-mercato/core/modules/dictionaries/components/DictionarySelectControl'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/booking/lib/capacityUnits'
import { buildResourceScheduleItems } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { BOOKING_RESOURCE_FIELDSET_DEFAULT, resolveBookingResourceFieldsetCode } from '@open-mercato/core/modules/booking/lib/resourceCustomFields'
import type { AvailabilityBookedEvent, AvailabilityScheduleItemBuilder } from '@open-mercato/core/modules/booking/backend/components/AvailabilitySchedule'
import { AvailabilitySchedule } from '@open-mercato/core/modules/booking/backend/components/AvailabilitySchedule'

const DEFAULT_PAGE_SIZE = 200

type ResourceRecord = {
  id: string
  name: string
  description?: string | null
  resourceTypeId: string | null
  capacity: number | null
  capacityUnitValue: string | null
  capacityUnitName: string | null
  capacityUnitColor: string | null
  capacityUnitIcon: string | null
  tags?: TagOption[] | null
  isActive: boolean
  isAvailableByDefault: boolean
  appearanceIcon?: string | null
  appearanceColor?: string | null
  resource_type_id?: string | null
  capacity_unit_value?: string | null
  capacity_unit_name?: string | null
  capacity_unit_color?: string | null
  capacity_unit_icon?: string | null
  appearance_icon?: string | null
  appearance_color?: string | null
  is_active?: boolean
  is_available_by_default?: boolean
} & Record<string, unknown>

type ResourceResponse = {
  items: ResourceRecord[]
}

type ResourceTypeRow = {
  id: string
  name: string
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

type BookedEventsResponse = {
  items: AvailabilityBookedEvent[]
}

function normalizeResourceRecord(record: ResourceRecord): ResourceRecord {
  return {
    ...record,
    resourceTypeId: record.resourceTypeId ?? record.resource_type_id ?? null,
    description: record.description ?? null,
    capacityUnitValue: record.capacityUnitValue ?? record.capacity_unit_value ?? null,
    capacityUnitName: record.capacityUnitName ?? record.capacity_unit_name ?? null,
    capacityUnitColor: record.capacityUnitColor ?? record.capacity_unit_color ?? null,
    capacityUnitIcon: record.capacityUnitIcon ?? record.capacity_unit_icon ?? null,
    appearanceIcon: record.appearanceIcon ?? record.appearance_icon ?? null,
    appearanceColor: record.appearanceColor ?? record.appearance_color ?? null,
    isActive: record.isActive ?? record.is_active ?? true,
    isAvailableByDefault: record.isAvailableByDefault ?? record.is_available_by_default ?? true,
  }
}

export default function BookingResourceDetailPage({ params }: { params?: { id?: string } }) {
  const resourceId = params?.id
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [resourceTypes, setResourceTypes] = React.useState<ResourceTypeRow[]>([])
  const [resourceTypesLoaded, setResourceTypesLoaded] = React.useState(false)
  const [tags, setTags] = React.useState<TagOption[]>([])
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [isAvailableByDefault, setIsAvailableByDefault] = React.useState(true)
  const [capacityUnitDictionaryId, setCapacityUnitDictionaryId] = React.useState<string | null>(null)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    if (!resourceId || !resourceTypesLoaded) return
    let cancelled = false
    async function loadResource() {
      try {
        const params = new URLSearchParams()
        params.set('page', '1')
        params.set('pageSize', '1')
        if (resourceId) params.set('ids', resourceId)
        const record = await readApiResultOrThrow<ResourceResponse>(`/api/booking/resources?${params.toString()}`)
        const resourceRaw = Array.isArray(record?.items) ? record.items[0] : null
        const resource = resourceRaw ? normalizeResourceRecord(resourceRaw) : null
        if (!resource) throw new Error(t('booking.resources.form.errors.notFound', 'Resource not found.'))
        if (!cancelled) {
          const customValues: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(resource)) {
            if (key.startsWith('cf_')) customValues[key] = value
            else if (key.startsWith('cf:')) customValues[`cf_${key.slice(3)}`] = value
          }
          setTags(Array.isArray(resource.tags) ? resource.tags : [])
          setIsAvailableByDefault(resource.isAvailableByDefault ?? true)
          setInitialValues({
            id: resource.id,
            name: resource.name,
            description: resource.description ?? '',
            resourceTypeId: resource.resourceTypeId || '',
            capacity: resource.capacity ?? '',
            capacityUnitValue: resource.capacityUnitValue ?? '',
            appearance: { icon: resource.appearanceIcon ?? null, color: resource.appearanceColor ?? null },
            isActive: resource.isActive ?? true,
            isAvailableByDefault: resource.isAvailableByDefault ?? true,
            customFieldsetCode: resolveFieldsetCode(resource.resourceTypeId ?? null),
            ...customValues,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.resources.form.errors.load', 'Failed to load resource.')
        flash(message, 'error')
      }
    }
    loadResource()
    return () => { cancelled = true }
  }, [resourceId, resolveFieldsetCode, resourceTypesLoaded, t])

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

  const availabilityMode = isAvailableByDefault ? 'unavailability' : 'availability'

  const loadBookedEvents = React.useCallback(async (nextRange: { start: Date; end: Date }): Promise<AvailabilityBookedEvent[]> => {
    if (!resourceId) return []
    const params = new URLSearchParams({
      resourceId,
      startsAt: nextRange.start.toISOString(),
      endsAt: nextRange.end.toISOString(),
    })
    const call = await apiCall<BookedEventsResponse>(`/api/booking/resource-events?${params.toString()}`)
    if (!call.ok) {
      throw new Error(t('booking.resources.schedule.error.load', 'Failed to load schedule.'))
    }
    return Array.isArray(call.result?.items) ? call.result.items : []
  }, [resourceId, t])

  const buildScheduleItems = React.useCallback<AvailabilityScheduleItemBuilder>(
    ({ availabilityRules, bookedEvents, translate }) => buildResourceScheduleItems({
      availabilityRules,
      bookedEvents,
      isAvailableByDefault,
      translate,
    }),
    [isAvailableByDefault],
  )

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

  const defaultAvailabilityLabel = t('booking.resources.form.fields.defaultAvailability', 'Available by default')
  const defaultAvailabilityDescription = t(
    'booking.resources.form.fields.defaultAvailability.help',
    'When unchecked, this resource is unavailable unless you add availability rules.',
  )

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
      label: defaultAvailabilityLabel,
      description: defaultAvailabilityDescription,
      type: 'custom',
      component: ({ value, setValue, disabled }) => (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={value === true}
            onChange={(event) => {
              const next = event.target.checked
              setValue(next)
              setIsAvailableByDefault(next)
            }}
            disabled={disabled}
          />
          <span className="text-sm">{defaultAvailabilityLabel}</span>
        </label>
      ),
    },
    {
      id: 'isActive',
      label: t('booking.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [
    appearanceLabels,
    capacityUnitDictionaryId,
    defaultAvailabilityDescription,
    defaultAvailabilityLabel,
    resolveFieldsetCode,
    resourceTypes,
    t,
  ])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!resourceId) return
    const nextIsAvailableByDefault = values.isAvailableByDefault ?? true
    const appearance = values.appearance && typeof values.appearance === 'object'
      ? values.appearance as { icon?: string | null; color?: string | null }
      : {}
    const { appearance: _appearance, customFieldsetCode: _customFieldsetCode, ...rest } = values
    const payload: Record<string, unknown> = {
      ...rest,
      id: resourceId,
      resourceTypeId: values.resourceTypeId || null,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      appearanceIcon: appearance.icon ?? null,
      appearanceColor: appearance.color ?? null,
      isActive: values.isActive ?? true,
      isAvailableByDefault: nextIsAvailableByDefault,
      ...collectCustomFieldValues(values),
    }
    if (!payload.name || String(payload.name).trim().length === 0) {
      throw createCrudFormError(t('booking.resources.form.errors.nameRequired', 'Name is required.'))
    }
    await updateCrud('booking/resources', payload, {
      errorMessage: t('booking.resources.form.errors.update', 'Failed to update resource.'),
    })
    setIsAvailableByDefault(Boolean(nextIsAvailableByDefault))
    flash(t('booking.resources.form.flash.updated', 'Resource updated.'), 'success')
  }, [resourceId, t])

  const tagLabels = React.useMemo(
    () => ({
      loading: t('booking.resources.tags.loading', 'Loading tags...'),
      placeholder: t('booking.resources.tags.placeholder', 'Type to add tags'),
      empty: t('booking.resources.tags.placeholder', 'No tags yet. Add labels to keep resources organized.'),
      loadError: t('booking.resources.tags.loadError', 'Failed to load tags.'),
      createError: t('booking.resources.tags.createError', 'Failed to create tag.'),
      updateError: t('booking.resources.tags.updateError', 'Failed to update tags.'),
      labelRequired: t('booking.resources.tags.labelRequired', 'Tag name is required.'),
      saveShortcut: t('booking.resources.tags.saveShortcut', 'Save Cmd+Enter / Ctrl+Enter'),
      cancelShortcut: t('booking.resources.tags.cancelShortcut', 'Cancel (Esc)'),
      edit: t('ui.forms.actions.edit', 'Edit'),
      cancel: t('ui.forms.actions.cancel', 'Cancel'),
      success: t('booking.resources.tags.success', 'Tags updated.'),
    }),
    [t],
  )

  const tabs = React.useMemo(() => ([
    { id: 'details', label: t('booking.resources.tabs.details', 'Details') },
    { id: 'availability', label: t('booking.resources.tabs.availability', 'Availability') },
  ]), [t])

  const loadTagOptions = React.useCallback(
    async (query?: string): Promise<TagOption[]> => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (query) params.set('search', query)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/booking/tags?${params.toString()}`,
        undefined,
        { errorMessage: t('booking.resources.tags.loadError', 'Failed to load tags.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items
        .map((item: unknown): TagOption | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as { id?: unknown; tagId?: unknown; label?: unknown; slug?: unknown; color?: unknown }
          const rawId =
            typeof raw.id === 'string'
              ? raw.id
              : typeof raw.tagId === 'string'
                ? raw.tagId
                : null
          if (!rawId) return null
          const labelValue =
            (typeof raw.label === 'string' && raw.label.trim().length && raw.label.trim()) ||
            (typeof raw.slug === 'string' && raw.slug.trim().length && raw.slug.trim()) ||
            rawId
          const color = typeof raw.color === 'string' && raw.color.trim().length ? raw.color.trim() : null
          return { id: rawId, label: labelValue, color }
        })
        .filter((entry): entry is TagOption => entry !== null)
    },
    [t],
  )

  const createTag = React.useCallback(
    async (label: string): Promise<TagOption> => {
      const trimmed = label.trim()
      if (!trimmed.length) {
        throw new Error(t('booking.resources.tags.labelRequired', 'Tag name is required.'))
      }
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/booking/tags',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: trimmed }),
        },
        { errorMessage: t('booking.resources.tags.createError', 'Failed to create tag.') },
      )
      const payload = response.result ?? {}
      const id =
        typeof payload?.id === 'string'
          ? payload.id
          : typeof (payload as any)?.tagId === 'string'
            ? (payload as any).tagId
            : ''
      if (!id) throw new Error(t('booking.resources.tags.createError', 'Failed to create tag.'))
      const color = typeof (payload as any)?.color === 'string' && (payload as any).color.trim().length
        ? (payload as any).color.trim()
        : null
      return { id, label: trimmed, color }
    },
    [t],
  )

  const handleTagsSave = React.useCallback(
    async ({ next }: { next: TagOption[] }) => {
      if (!resourceId) return
      const tagIds = Array.from(new Set(next.map((tag) => tag.id)))
      await updateCrud('booking/resources', { id: resourceId, tags: tagIds }, {
        errorMessage: t('booking.resources.tags.updateError', 'Failed to update tags.'),
      })
      setTags(next)
      flash(t('booking.resources.tags.success', 'Tags updated.'), 'success')
    },
    [resourceId, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!resourceId) return
    await deleteCrud('booking/resources', resourceId, {
      errorMessage: t('booking.resources.form.errors.delete', 'Failed to delete resource.'),
    })
    flash(t('booking.resources.form.flash.deleted', 'Resource deleted.'), 'success')
    router.push('/backend/booking/resources')
  }, [resourceId, router, t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={t('booking.resources.tabs.label', 'Resource sections')}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id as 'details' | 'availability')}
                  className={`relative -mb-px border-b-2 px-0 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activeTab === 'details' ? (
            <>
              <CrudForm
                title={t('booking.resources.form.editTitle', 'Edit resource')}
                backHref="/backend/booking/resources"
                cancelHref="/backend/booking/resources"
                fields={fields}
                initialValues={initialValues ?? undefined}
                entityId={E.booking.booking_resource}
                customFieldsetBindings={{ [E.booking.booking_resource]: { valueKey: 'customFieldsetCode' } }}
                onSubmit={handleSubmit}
                onDelete={handleDelete}
                isLoading={!initialValues}
                loadingMessage={t('booking.resources.form.loading', 'Loading resource...')}
              />

              <div className="mt-6">
                <TagsSection
                  title={t('booking.resources.tags.title', 'Tags')}
                  tags={tags}
                  onChange={setTags}
                  loadOptions={loadTagOptions}
                  createTag={createTag}
                  onSave={handleTagsSave}
                  labels={tagLabels}
                />
              </div>
            </>
          ) : (
            <AvailabilitySchedule
              subjectType="resource"
              subjectId={resourceId ?? ''}
              labelPrefix="booking.resources"
              mode={availabilityMode}
              buildScheduleItems={buildScheduleItems}
              loadBookedEvents={loadBookedEvents}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
