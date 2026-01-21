"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { type TagOption } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildResourceScheduleItems } from '@open-mercato/core/modules/resources/lib/resourceSchedule'
import { RESOURCES_RESOURCE_FIELDSET_DEFAULT } from '@open-mercato/core/modules/resources/lib/resourceCustomFields'
import type { AvailabilityScheduleItemBuilder } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { ResourcesResourceForm, useResourcesResourceFormConfig } from '@open-mercato/core/modules/resources/components/ResourceCrudForm'

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

export default function ResourcesResourceDetailPage({ params }: { params?: { id?: string } }) {
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
      flash(t('resources.resources.flash.createdAvailability', 'Saved. You can now set availability.'), 'success')
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('created')
      const nextQuery = nextParams.toString()
      const nextPath = resourceId
        ? `/backend/resources/resources/${encodeURIComponent(resourceId)}${nextQuery ? `?${nextQuery}` : ''}`
        : `/backend/resources/resources${nextQuery ? `?${nextQuery}` : ''}`
      router.replace(nextPath)
    }
  }, [resourceId, router, searchParams, t])

  const buildScheduleItems = React.useCallback<AvailabilityScheduleItemBuilder>(
    ({ availabilityRules, translate }) => buildResourceScheduleItems({
      availabilityRules,
      isAvailableByDefault: false,
      translate,
    }),
    [],
  )

  const tagLabels = React.useMemo(
    () => ({
      loading: t('resources.resources.tags.loading', 'Loading tags...'),
      placeholder: t('resources.resources.tags.placeholder', 'Type to add tags'),
      empty: t('resources.resources.tags.placeholder', 'No tags yet. Add labels to keep resources organized.'),
      loadError: t('resources.resources.tags.loadError', 'Failed to load tags.'),
      createError: t('resources.resources.tags.createError', 'Failed to create tag.'),
      updateError: t('resources.resources.tags.updateError', 'Failed to update tags.'),
      labelRequired: t('resources.resources.tags.labelRequired', 'Tag name is required.'),
      saveShortcut: t('resources.resources.tags.saveShortcut', 'Save Cmd+Enter / Ctrl+Enter'),
      cancelShortcut: t('resources.resources.tags.cancelShortcut', 'Cancel (Esc)'),
      edit: t('ui.forms.actions.edit', 'Edit'),
      cancel: t('ui.forms.actions.cancel', 'Cancel'),
      success: t('resources.resources.tags.success', 'Tags updated.'),
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
      : RESOURCES_RESOURCE_FIELDSET_DEFAULT
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
      throw createCrudFormError(t('resources.resources.form.errors.nameRequired', 'Name is required.'))
    }
    await updateCrud('resources/resources', payload, {
      errorMessage: t('resources.resources.form.errors.update', 'Failed to update resource.'),
    })
    flash(t('resources.resources.form.flash.updated', 'Resource updated.'), 'success')
  }, [resourceId, t])

  const tabs = React.useMemo(() => ([
    { id: 'details', label: t('resources.resources.tabs.details', 'Details') },
    { id: 'availability', label: t('resources.resources.tabs.availability', 'Availability') },
  ]), [t])

  const loadTagOptions = React.useCallback(
    async (query?: string): Promise<TagOption[]> => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (query) params.set('search', query)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/resources/tags?${params.toString()}`,
        undefined,
        { errorMessage: t('resources.resources.tags.loadError', 'Failed to load tags.') },
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
        throw new Error(t('resources.resources.tags.labelRequired', 'Tag name is required.'))
      }
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/resources/tags',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: trimmed }),
        },
        { errorMessage: t('resources.resources.tags.createError', 'Failed to create tag.') },
      )
      const payload = response.result ?? {}
      const id =
        typeof payload?.id === 'string'
          ? payload.id
          : typeof (payload as any)?.tagId === 'string'
            ? (payload as any).tagId
            : ''
      if (!id) throw new Error(t('resources.resources.tags.createError', 'Failed to create tag.'))
      const color = typeof (payload as any)?.color === 'string' && (payload as any).color.trim().length
        ? (payload as any).color.trim()
        : null
      return { id, label: trimmed, color }
    },
    [t],
  )

  const assignTag = React.useCallback(async (tagId: string) => {
    if (!resourceId) return
    await apiCallOrThrow(
      '/api/resources/resources/tags/assign',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId, resourceId }),
      },
      { errorMessage: t('resources.resources.tags.updateError', 'Failed to update tags.') },
    )
  }, [resourceId, t])

  const unassignTag = React.useCallback(async (tagId: string) => {
    if (!resourceId) return
    await apiCallOrThrow(
      '/api/resources/resources/tags/unassign',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId, resourceId }),
      },
      { errorMessage: t('resources.resources.tags.updateError', 'Failed to update tags.') },
    )
  }, [resourceId, t])

  const handleTagsSave = React.useCallback(
    async ({ next, added, removed }: { next: TagOption[]; added: TagOption[]; removed: TagOption[] }) => {
      if (!resourceId) return
      for (const tag of added) {
        await assignTag(tag.id)
      }
      for (const tag of removed) {
        await unassignTag(tag.id)
      }
      setTags(next)
      flash(t('resources.resources.tags.success', 'Tags updated.'), 'success')
    },
    [assignTag, resourceId, t, unassignTag],
  )

  const tagsSection = React.useMemo(
    () => ({
      title: t('resources.resources.tags.title', 'Tags'),
      tags,
      onChange: setTags,
      loadOptions: loadTagOptions,
      createTag,
      onSave: handleTagsSave,
      labels: tagLabels,
    }),
    [createTag, handleTagsSave, loadTagOptions, t, tagLabels, tags],
  )

  const formConfig = useResourcesResourceFormConfig({ tagsSection })
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
        const record = await readApiResultOrThrow<ResourceResponse>(`/api/resources/resources?${params.toString()}`)
        const resourceRaw = Array.isArray(record?.items) ? record.items[0] : null
        const resource = resourceRaw ? normalizeResourceRecord(resourceRaw) : null
        if (!resource) throw new Error(t('resources.resources.form.errors.notFound', 'Resource not found.'))
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
              : RESOURCES_RESOURCE_FIELDSET_DEFAULT,
            ...customValues,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('resources.resources.form.errors.load', 'Failed to load resource.')
        flash(message, 'error')
      }
    }
    loadResource()
    return () => { cancelled = true }
  }, [resourceId, resourceTypesLoaded, resolveFieldsetCode, t])

  const handleDelete = React.useCallback(async () => {
    if (!resourceId) return
    await deleteCrud('resources/resources', resourceId, {
      errorMessage: t('resources.resources.form.errors.delete', 'Failed to delete resource.'),
    })
    flash(t('resources.resources.form.flash.deleted', 'Resource deleted.'), 'success')
    router.push('/backend/resources/resources')
  }, [resourceId, router, t])

  const handleRulesetChange = React.useCallback(async (nextId: string | null) => {
    if (!resourceId) return
    await updateCrud('resources/resources', { id: resourceId, availabilityRuleSetId: nextId }, {
      errorMessage: t('resources.resources.availability.ruleset.updateError', 'Failed to update schedule.'),
    })
    setAvailabilityRuleSetId(nextId)
    flash(t('resources.resources.availability.ruleset.updateSuccess', 'Schedule updated.'), 'success')
  }, [resourceId, t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={t('resources.resources.tabs.label', 'Resource sections')}>
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
              <ResourcesResourceForm
                title={t('resources.resources.form.editTitle', 'Edit resource')}
                backHref="/backend/resources/resources"
                cancelHref="/backend/resources/resources"
                successRedirect="/backend/resources/resources"
                formConfig={formConfig}
                initialValues={initialValues ?? undefined}
                onSubmit={handleSubmit}
                onDelete={handleDelete}
                isLoading={!initialValues}
                loadingMessage={t('resources.resources.form.loading', 'Loading resource...')}
              />
            </>
          ) : (
            <AvailabilityRulesEditor
              subjectType="resource"
              subjectId={resourceId ?? ''}
              labelPrefix="resources.resources"
              mode={availabilityMode}
              rulesetId={availabilityRuleSetId}
              onRulesetChange={handleRulesetChange}
              buildScheduleItems={buildScheduleItems}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
