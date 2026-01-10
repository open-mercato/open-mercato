"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { type TagOption } from '@open-mercato/ui/backend/detail'
import { useT } from '@/lib/i18n/context'
import { buildResourceScheduleItems } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { BOOKING_RESOURCE_FIELDSET_DEFAULT } from '@open-mercato/core/modules/booking/lib/resourceCustomFields'
import type { AvailabilityBookedEvent, AvailabilityScheduleItemBuilder } from '@open-mercato/core/modules/booking/components/AvailabilityRulesEditor'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/booking/components/AvailabilityRulesEditor'
import { BookingResourceForm, useBookingResourceFormConfig } from '@open-mercato/core/modules/booking/components/ResourceCrudForm'

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
  availabilityRuleSetId?: string | null
  availability_rule_set_id?: string | null
} & Record<string, unknown>

type ResourceResponse = {
  items: ResourceRecord[]
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
  }
}

export default function BookingResourceDetailPage({ params }: { params?: { id?: string } }) {
  const resourceId = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [tags, setTags] = React.useState<TagOption[]>([])
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [availabilityRuleSetId, setAvailabilityRuleSetId] = React.useState<string | null>(null)
  const flashShownRef = React.useRef(false)

  const availabilityMode = 'availability'

  React.useEffect(() => {
    if (!searchParams) return
    const tabParam = searchParams.get('tab')
    if (tabParam === 'availability') {
      setActiveTab('availability')
    }
    const created = searchParams.get('created') === '1'
    if (created && !flashShownRef.current) {
      flashShownRef.current = true
      flash(t('booking.resources.flash.createdAvailability', 'Saved. You can now set availability.'), 'success')
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('created')
      const nextQuery = nextParams.toString()
      const nextPath = resourceId
        ? `/backend/booking/resources/${encodeURIComponent(resourceId)}${nextQuery ? `?${nextQuery}` : ''}`
        : `/backend/booking/resources${nextQuery ? `?${nextQuery}` : ''}`
      router.replace(nextPath)
    }
  }, [resourceId, router, searchParams, t])

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
      isAvailableByDefault: false,
      translate,
    }),
    [],
  )

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

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!resourceId) return
    const appearance = values.appearance && typeof values.appearance === 'object'
      ? values.appearance as { icon?: string | null; color?: string | null }
      : {}
    const { appearance: _appearance, ...rest } = values
    const customFieldsetCode = typeof values.customFieldsetCode === 'string' && values.customFieldsetCode.trim().length
      ? values.customFieldsetCode.trim()
      : BOOKING_RESOURCE_FIELDSET_DEFAULT
    const payload: Record<string, unknown> = {
      ...rest,
      id: resourceId,
      resourceTypeId: values.resourceTypeId || null,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      appearanceIcon: appearance.icon ?? null,
      appearanceColor: appearance.color ?? null,
      isActive: values.isActive ?? true,
      customFieldsetCode,
      ...collectCustomFieldValues(values),
    }
    if (!payload.name || String(payload.name).trim().length === 0) {
      throw createCrudFormError(t('booking.resources.form.errors.nameRequired', 'Name is required.'))
    }
    await updateCrud('booking/resources', payload, {
      errorMessage: t('booking.resources.form.errors.update', 'Failed to update resource.'),
    })
    flash(t('booking.resources.form.flash.updated', 'Resource updated.'), 'success')
  }, [resourceId, t])

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

  const tagsSection = React.useMemo(
    () => ({
      title: t('booking.resources.tags.title', 'Tags'),
      tags,
      onChange: setTags,
      loadOptions: loadTagOptions,
      createTag,
      onSave: handleTagsSave,
      labels: tagLabels,
    }),
    [createTag, handleTagsSave, loadTagOptions, t, tagLabels, tags],
  )

  const formConfig = useBookingResourceFormConfig({ tagsSection })
  const { resourceTypesLoaded, resolveFieldsetCode } = formConfig

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
          setAvailabilityRuleSetId(
            typeof resource.availabilityRuleSetId === 'string'
              ? resource.availabilityRuleSetId
              : typeof resource.availability_rule_set_id === 'string'
                ? resource.availability_rule_set_id
                : null,
          )
          setInitialValues({
            id: resource.id,
            name: resource.name,
            description: resource.description ?? '',
            resourceTypeId: resource.resourceTypeId || '',
            capacity: resource.capacity ?? '',
            capacityUnitValue: resource.capacityUnitValue ?? '',
            appearance: { icon: resource.appearanceIcon ?? null, color: resource.appearanceColor ?? null },
            isActive: resource.isActive ?? true,
            customFieldsetCode: resource.resourceTypeId
              ? resolveFieldsetCode(resource.resourceTypeId)
              : BOOKING_RESOURCE_FIELDSET_DEFAULT,
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
  }, [resourceId, resourceTypesLoaded, resolveFieldsetCode, t])

  const handleDelete = React.useCallback(async () => {
    if (!resourceId) return
    await deleteCrud('booking/resources', resourceId, {
      errorMessage: t('booking.resources.form.errors.delete', 'Failed to delete resource.'),
    })
    flash(t('booking.resources.form.flash.deleted', 'Resource deleted.'), 'success')
    router.push('/backend/booking/resources')
  }, [resourceId, router, t])

  const handleRulesetChange = React.useCallback(async (nextId: string | null) => {
    if (!resourceId) return
    await updateCrud('booking/resources', { id: resourceId, availabilityRuleSetId: nextId }, {
      errorMessage: t('booking.resources.availability.ruleset.updateError', 'Failed to update schedule.'),
    })
    setAvailabilityRuleSetId(nextId)
    flash(t('booking.resources.availability.ruleset.updateSuccess', 'Schedule updated.'), 'success')
  }, [resourceId, t])

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
              <BookingResourceForm
                title={t('booking.resources.form.editTitle', 'Edit resource')}
                backHref="/backend/booking/resources"
                cancelHref="/backend/booking/resources"
                successRedirect="/backend/booking/resources"
                formConfig={formConfig}
                initialValues={initialValues ?? undefined}
                onSubmit={handleSubmit}
                onDelete={handleDelete}
                isLoading={!initialValues}
                loadingMessage={t('booking.resources.form.loading', 'Loading resource...')}
              />
            </>
          ) : (
            <AvailabilityRulesEditor
              subjectType="resource"
              subjectId={resourceId ?? ''}
              labelPrefix="booking.resources"
              mode={availabilityMode}
              rulesetId={availabilityRuleSetId}
              onRulesetChange={handleRulesetChange}
              buildScheduleItems={buildScheduleItems}
              loadBookedEvents={loadBookedEvents}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
