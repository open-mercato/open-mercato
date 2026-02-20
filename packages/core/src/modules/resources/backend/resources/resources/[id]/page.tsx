"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ActivitiesSection, NotesSection, type SectionAction, type TagOption } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { buildResourceScheduleItems } from '@open-mercato/core/modules/resources/lib/resourceSchedule'
import { RESOURCES_RESOURCE_FIELDSET_DEFAULT } from '@open-mercato/core/modules/resources/lib/resourceCustomFields'
import type { AvailabilityScheduleItemBuilder } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { ResourcesResourceForm, useResourcesResourceFormConfig } from '@open-mercato/core/modules/resources/components/ResourceCrudForm'
import { TranslationsAction } from '@open-mercato/core/modules/translations/components/TranslationsAction'
import { renderDictionaryColor, renderDictionaryIcon, ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { createResourceNotesAdapter } from '@open-mercato/core/modules/resources/components/detail/notesAdapter'
import { createResourceActivitiesAdapter } from '@open-mercato/core/modules/resources/components/detail/activitiesAdapter'
import {
  createResourceDictionaryEntry,
  loadResourceDictionary,
  type DictionaryEntryOption,
} from '@open-mercato/core/modules/resources/components/detail/dictionaries'
import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'

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
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const router = useRouter()
  const searchParams = useSearchParams()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [tags, setTags] = React.useState<TagOption[]>([])
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [activeDetailTab, setActiveDetailTab] = React.useState<'notes' | 'activities'>('notes')
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const [availabilityRuleSetId, setAvailabilityRuleSetId] = React.useState<string | null>(null)
  const [activityDictionaryId, setActivityDictionaryId] = React.useState<string | null>(null)
  const [activityTypeEntries, setActivityTypeEntries] = React.useState<DictionaryEntryOption[]>([])
  const flashShownRef = React.useRef(false)

  const availabilityMode = 'availability'
  const notesAdapter = React.useMemo(() => createResourceNotesAdapter(detailTranslator), [detailTranslator])
  const activitiesAdapter = React.useMemo(() => createResourceActivitiesAdapter(detailTranslator), [detailTranslator])

  const activityTypeLabels = React.useMemo<DictionarySelectLabels>(() => ({
    placeholder: t('resources.resources.detail.activities.dictionary.placeholder', 'Select an activity type'),
    addLabel: t('resources.resources.detail.activities.dictionary.add', 'Add type'),
    addPrompt: t('resources.resources.detail.activities.dictionary.prompt', 'Name the type'),
    dialogTitle: t('resources.resources.detail.activities.dictionary.dialogTitle', 'Add activity type'),
    valueLabel: t('resources.resources.detail.activities.dictionary.valueLabel', 'Name'),
    valuePlaceholder: t('resources.resources.detail.activities.dictionary.valuePlaceholder', 'Name'),
    labelLabel: t('resources.resources.detail.activities.dictionary.labelLabel', 'Label'),
    labelPlaceholder: t('resources.resources.detail.activities.dictionary.labelPlaceholder', 'Display name shown in UI'),
    emptyError: t('resources.resources.detail.activities.dictionary.emptyError', 'Please enter a name'),
    cancelLabel: t('resources.resources.detail.activities.dictionary.cancel', 'Cancel'),
    saveLabel: t('resources.resources.detail.activities.dictionary.save', 'Save'),
    saveShortcutHint: t('resources.resources.detail.activities.dictionary.saveShortcut', '⌘/Ctrl + Enter'),
    errorLoad: t('resources.resources.detail.activities.dictionary.errorLoad', 'Failed to load options'),
    errorSave: t('resources.resources.detail.activities.dictionary.errorSave', 'Failed to save option'),
    loadingLabel: t('resources.resources.detail.activities.dictionary.loading', 'Loading…'),
    manageTitle: t('resources.resources.detail.activities.dictionary.manage', 'Manage dictionary'),
  }), [t])

  const loadActivityOptions = React.useCallback(async () => {
    const { dictionary, entries } = await loadResourceDictionary('activityTypes')
    setActivityDictionaryId(dictionary?.id ?? null)
    setActivityTypeEntries(entries)
    return entries
  }, [])

  const createActivityOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const entry = await createResourceDictionaryEntry('activityTypes', input)
      if (!entry) {
        throw new Error(t('resources.resources.detail.activities.dictionary.errorSave', 'Failed to save option'))
      }
      return entry
    },
    [t],
  )

  React.useEffect(() => {
    loadActivityOptions().catch(() => {})
  }, [loadActivityOptions])

  const activityTypeMap = React.useMemo(
    () => new Map(activityTypeEntries.map((entry) => [entry.value, entry])),
    [activityTypeEntries],
  )

  const resolveActivityPresentation = React.useCallback(
    (activity: { activityType: string; appearanceIcon?: string | null; appearanceColor?: string | null }) => {
      const entry = activityTypeMap.get(activity.activityType)
      return {
        label: entry?.label ?? activity.activityType,
        icon: entry?.icon ?? activity.appearanceIcon ?? null,
        color: entry?.color ?? activity.appearanceColor ?? null,
      }
    },
    [activityTypeMap],
  )

  const manageActivityHref = React.useMemo(() => {
    if (!activityDictionaryId) return '/backend/config/dictionaries'
    return `/backend/config/dictionaries?dictionaryId=${encodeURIComponent(activityDictionaryId)}`
  }, [activityDictionaryId])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('resources.resources.detail.activities.appearance.colorLabel', 'Color'),
    colorHelp: t('resources.resources.detail.activities.appearance.colorHelp', 'Pick a highlight color for this entry.'),
    colorClearLabel: t('resources.resources.detail.activities.appearance.colorClear', 'Remove color'),
    iconLabel: t('resources.resources.detail.activities.appearance.iconLabel', 'Icon or emoji'),
    iconPlaceholder: t('resources.resources.detail.activities.appearance.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
    iconPickerTriggerLabel: t('resources.resources.detail.activities.appearance.iconBrowse', 'Browse icons and emojis'),
    iconSearchPlaceholder: t('resources.resources.detail.activities.appearance.iconSearchPlaceholder', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('resources.resources.detail.activities.appearance.iconSearchEmpty', 'No icons match your search.'),
    iconSuggestionsLabel: t('resources.resources.detail.activities.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('resources.resources.detail.activities.appearance.iconClear', 'Remove icon'),
    previewEmptyLabel: t('resources.resources.detail.activities.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const renderCustomFields = React.useCallback((activity: { id?: string; customFields?: Array<{ key: string; label?: string | null; value: unknown }> }) => {
    const entries = Array.isArray(activity.customFields) ? activity.customFields : []
    if (!entries.length) return null
    const emptyLabel = t('resources.resources.detail.activities.customFields.empty', 'Not provided')
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry, index) => {
          const label = entry.label ?? entry.key
          const value = entry.value
          const hasValue = !(value == null || value === '' || (Array.isArray(value) && value.length === 0))
          const content = hasValue
            ? Array.isArray(value)
              ? value.map((item) => String(item)).join(', ')
              : String(value)
            : emptyLabel
          return (
            <div
              key={`activity-${activity.id ?? 'row'}-custom-${index}`}
              className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
            >
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              <div className="mt-1 text-sm text-foreground">{content}</div>
            </div>
          )
        })}
      </div>
    )
  }, [t])

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
  const detailTabs = React.useMemo(() => ([
    { id: 'notes' as const, label: t('resources.resources.detail.tabs.notes', 'Notes') },
    { id: 'activities' as const, label: t('resources.resources.detail.tabs.activities', 'Activities') },
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
              <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    {detailTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveDetailTab(tab.id)}
                        className={`relative -mb-px border-b-2 px-0 py-1 text-sm font-medium transition-colors ${
                          activeDetailTab === tab.id
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {sectionAction ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={sectionAction.disabled}
                      onClick={() => sectionAction.onClick()}
                    >
                      {sectionAction.icon ?? null}
                      {sectionAction.label}
                    </Button>
                  ) : null}
                </div>
                {activeDetailTab === 'notes' ? (
                  <NotesSection
                    entityId={resourceId ?? null}
                    emptyLabel={t('resources.resources.detail.notes.empty', 'No notes yet.')}
                    viewerUserId={null}
                    viewerName={null}
                    viewerEmail={null}
                    addActionLabel={t('resources.resources.detail.notes.add', 'Add note')}
                    emptyState={{
                      title: t('resources.resources.detail.notes.emptyTitle', 'Keep everyone in the loop'),
                      actionLabel: t('resources.resources.detail.notes.emptyAction', 'Add a note'),
                    }}
                    onActionChange={setSectionAction}
                    translator={detailTranslator}
                    labelPrefix="resources.resources.detail.notes"
                    inlineLabelPrefix="resources.resources.detail.inline"
                    dataAdapter={notesAdapter}
                    renderIcon={renderDictionaryIcon}
                    renderColor={renderDictionaryColor}
                    iconSuggestions={ICON_SUGGESTIONS}
                  />
                ) : null}
                {activeDetailTab === 'activities' ? (
                  <ActivitiesSection
                    entityId={resourceId ?? null}
                    addActionLabel={t('resources.resources.detail.activities.add', 'Log activity')}
                    emptyState={{
                      title: t('resources.resources.detail.activities.emptyTitle', 'No activities yet'),
                      actionLabel: t('resources.resources.detail.activities.emptyAction', 'Add an activity'),
                    }}
                    onActionChange={setSectionAction}
                    dataAdapter={activitiesAdapter}
                    activityTypeLabels={activityTypeLabels}
                    loadActivityOptions={loadActivityOptions}
                    createActivityOption={createActivityOption}
                    resolveActivityPresentation={resolveActivityPresentation}
                    renderCustomFields={renderCustomFields}
                    labelPrefix="resources.resources.detail.activities"
                    renderIcon={renderDictionaryIcon}
                    renderColor={renderDictionaryColor}
                    appearanceLabels={appearanceLabels}
                    manageHref={manageActivityHref}
                    customFieldEntityIds={['resources:resources_resource_activity']}
                  />
                ) : null}
              </div>

              <div className="rounded-lg border bg-card p-4">
                <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
                  {t('resources.resources.detail.formTitle', 'Resource settings')}
                </h2>
                <ResourcesResourceForm
                  embedded
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
                  extraActions={
                    <TranslationsAction
                      config={resourceId ? { entityType: 'resources:resources_resource', recordId: resourceId, baseValues: initialValues ?? undefined } : null}
                    />
                  }
                />
              </div>
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
