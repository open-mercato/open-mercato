'use client'

import * as React from 'react'
import { Check, Plus, Search, SlidersHorizontal, Tag, X } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn, slugifyTagLabel } from '@open-mercato/shared/lib/utils'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import type { TagSummary } from './types'
import { ManageTagsDialog } from './ManageTagsDialog'

type DictEntry = { id: string; value: string; label: string; color?: string | null }

type LabelItem = { id: string; slug: string; label: string }

type KindSetting = {
  kind: string
  selectionMode: 'single' | 'multi'
  visibleInTags: boolean
  sortOrder: number
}

type CategorySource = 'dictionary' | 'tags' | 'labels'

type EntityTagData = {
  status?: string | null
  lifecycleStage?: string | null
  source?: string | null
  temperature?: string | null
  renewalQuarter?: string | null
  jobTitle?: string | null
  industry?: string | null
  tags?: TagSummary[]
}

type CategoryOption = {
  id: string
  value: string
  label: string
  color?: string | null
}

type CategoryDef = {
  kind: string
  source: CategorySource
  supportedEntityTypes: Array<'person' | 'company'>
  labelKey: string
  labelFallback: string
  descriptionKey: string
  descriptionFallback: string
  routeKind?: string
  settingKind?: string
  entityField?: keyof EntityTagData
  selectionMode?: 'single' | 'multi'
  hasColorDots: boolean
  supportsCreate?: boolean
}

type CategorySection = CategoryDef & {
  label: string
  description: string
  entries: CategoryOption[]
  selectionMode: 'single' | 'multi'
}

export type EntityTagsDialogProps = {
  open: boolean
  onClose: () => void
  entityId: string
  entityType: 'person' | 'company'
  entityOrganizationId: string | null
  entityData: EntityTagData
  onSaved?: () => void
}

const CATEGORY_DEFS: CategoryDef[] = [
  {
    kind: 'tags',
    source: 'tags',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.tags',
    labelFallback: 'Tags',
    descriptionKey: 'customers.personTags.description.tags',
    descriptionFallback: 'Shared CRM tags that can be assigned to many records.',
    selectionMode: 'multi',
    hasColorDots: true,
    supportsCreate: true,
  },
  {
    kind: 'labels',
    source: 'labels',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.labels',
    labelFallback: 'Labels',
    descriptionKey: 'customers.personTags.description.labels',
    descriptionFallback: 'Quick labels you can create inline for this record.',
    selectionMode: 'multi',
    hasColorDots: false,
    supportsCreate: true,
  },
  {
    kind: 'statuses',
    source: 'dictionary',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.statuses',
    labelFallback: 'Status',
    descriptionKey: 'customers.personTags.description.statuses',
    descriptionFallback: 'Primary CRM status shown in the header badges.',
    routeKind: 'statuses',
    settingKind: 'status',
    entityField: 'status',
    selectionMode: 'single',
    hasColorDots: true,
  },
  {
    kind: 'lifecycle-stages',
    source: 'dictionary',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.lifecycle-stages',
    labelFallback: 'Lifecycle',
    descriptionKey: 'customers.personTags.description.lifecycleStages',
    descriptionFallback: 'Lifecycle stage used across CRM detail views.',
    routeKind: 'lifecycle-stages',
    settingKind: 'lifecycle_stage',
    entityField: 'lifecycleStage',
    selectionMode: 'single',
    hasColorDots: true,
  },
  {
    kind: 'sources',
    source: 'dictionary',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.sources',
    labelFallback: 'Source',
    descriptionKey: 'customers.personTags.description.sources',
    descriptionFallback: 'How this record entered the pipeline.',
    routeKind: 'sources',
    settingKind: 'source',
    entityField: 'source',
    selectionMode: 'single',
    hasColorDots: true,
  },
  {
    kind: 'temperature',
    source: 'dictionary',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.temperature',
    labelFallback: 'Temperature',
    descriptionKey: 'customers.personTags.description.temperature',
    descriptionFallback: 'Sales temperature or engagement level.',
    routeKind: 'temperature',
    settingKind: 'temperature',
    entityField: 'temperature',
    selectionMode: 'single',
    hasColorDots: true,
  },
  {
    kind: 'renewal-quarters',
    source: 'dictionary',
    supportedEntityTypes: ['person', 'company'],
    labelKey: 'customers.personTags.category.renewal-quarters',
    labelFallback: 'Renewal quarter',
    descriptionKey: 'customers.personTags.description.renewalQuarters',
    descriptionFallback: 'Quarter used for renewal planning and badges.',
    routeKind: 'renewal-quarters',
    settingKind: 'renewal_quarter',
    entityField: 'renewalQuarter',
    selectionMode: 'single',
    hasColorDots: true,
  },
  {
    kind: 'job-titles',
    source: 'dictionary',
    supportedEntityTypes: ['person'],
    labelKey: 'customers.personTags.category.job-titles',
    labelFallback: 'Job title',
    descriptionKey: 'customers.personTags.description.jobTitles',
    descriptionFallback: 'The role or title used for this person.',
    routeKind: 'job-titles',
    settingKind: 'job_title',
    entityField: 'jobTitle',
    selectionMode: 'single',
    hasColorDots: true,
  },
  {
    kind: 'industries',
    source: 'dictionary',
    supportedEntityTypes: ['company'],
    labelKey: 'customers.personTags.category.industries',
    labelFallback: 'Industry',
    descriptionKey: 'customers.personTags.description.industries',
    descriptionFallback: 'The industry used to classify this company.',
    routeKind: 'industries',
    settingKind: 'industry',
    entityField: 'industry',
    selectionMode: 'single',
    hasColorDots: true,
  },
]

function cloneSelectionMap(values: Record<string, Set<string>>): Record<string, Set<string>> {
  return Object.fromEntries(
    Object.entries(values).map(([key, selection]) => [key, new Set(selection)]),
  )
}

function sortOptions(entries: CategoryOption[]): CategoryOption[] {
  return [...entries].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
  )
}

function TagChip({
  label,
  color,
  active,
  showColorDot,
  onClick,
}: {
  label: string
  color?: string | null
  active: boolean
  showColorDot: boolean
  onClick: () => void
}) {
  const activeColorStyle: React.CSSProperties | undefined =
    active && color
      ? { color, borderColor: color, backgroundColor: `${color}1A` }
      : undefined
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        'inline-flex h-auto items-center gap-[5px] rounded-full border px-[10px] py-[6px] transition-colors',
        active
          ? activeColorStyle
            ? 'font-semibold hover:opacity-90'
            : 'border-transparent bg-muted font-semibold text-foreground hover:bg-muted'
          : 'border-border bg-transparent font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      style={activeColorStyle}
    >
      {showColorDot && color ? (
        <span
          className="inline-block size-[7px] shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="text-[12px]">{label}</span>
      {active ? <X className="size-[10px] shrink-0" /> : null}
    </Button>
  )
}

function buildApplicableCategories(entityType: 'person' | 'company') {
  return CATEGORY_DEFS.filter((category) => category.supportedEntityTypes.includes(entityType))
}

export function EntityTagsDialog({
  open,
  onClose,
  entityId,
  entityType,
  entityOrganizationId,
  entityData,
  onSaved,
}: EntityTagsDialogProps) {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState('')
  const [categories, setCategories] = React.useState<CategorySection[]>([])
  const [selectedValues, setSelectedValues] = React.useState<Record<string, Set<string>>>({})
  const [originalValues, setOriginalValues] = React.useState<Record<string, Set<string>>>({})
  const [activeCategoryKind, setActiveCategoryKind] = React.useState<string | null>(null)
  const [newEntryInputByKind, setNewEntryInputByKind] = React.useState<Record<string, string | null>>({})
  const [creatingKind, setCreatingKind] = React.useState<string | null>(null)
  const [manageTagsOpen, setManageTagsOpen] = React.useState(false)
  const creationInFlightRef = React.useRef<string | null>(null)
  const mutationContextId = React.useMemo(
    () => `customer-tags:${entityType}:${entityId}`,
    [entityId, entityType],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    entityType: 'person' | 'company'
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      resourceKind: entityType === 'person' ? 'customers.person' : 'customers.company',
      resourceId: entityId,
      entityType,
      retryLastMutation,
    }),
    [entityId, entityType, mutationContextId, retryLastMutation],
  )
  const runGuardedMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload: Record<string, unknown>) =>
      runMutation({
        operation,
        mutationPayload,
        context: mutationContext,
      }),
    [mutationContext, runMutation],
  )

  const updateCategoryEntries = React.useCallback(
    (kind: string, updater: (entries: CategoryOption[]) => CategoryOption[]) => {
      setCategories((previous) =>
        previous.map((category) =>
          category.kind === kind
            ? { ...category, entries: sortOptions(updater(category.entries)) }
            : category,
        ),
      )
    },
    [],
  )

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      let kindSettings: KindSetting[] = []
      const scopedQuery = new URLSearchParams()
      if (entityOrganizationId) {
        scopedQuery.set('organizationId', entityOrganizationId)
      }
      try {
        const settingsCall = await apiCall<{ items?: KindSetting[] }>(
          `/api/customers/dictionaries/kind-settings${scopedQuery.size ? `?${scopedQuery.toString()}` : ''}`,
          { cache: 'no-store', headers: { 'x-om-unauthorized-redirect': '0' } },
        )
        if (settingsCall.ok && settingsCall.result?.items) {
          kindSettings = settingsCall.result.items
        }
      } catch {
        // Default category order works without explicit settings rows.
      }

      const settingsMap = new Map(kindSettings.map((setting) => [setting.kind, setting]))

      let availableTags: CategoryOption[] = []
      try {
        const tagsQuery = new URLSearchParams({ pageSize: '100' })
        const tagsCall = await apiCall<{ items?: DictEntry[] }>(
          `/api/customers/tags?${tagsQuery.toString()}`,
          { cache: 'no-store', headers: { 'x-om-unauthorized-redirect': '0' } },
        )
        const tagItems = tagsCall.ok ? tagsCall.result?.items ?? [] : []
        availableTags = tagItems.map((tag) => ({
          id: tag.id,
          value: tag.id,
          label: tag.label,
          color: tag.color ?? null,
        }))
      } catch {
        availableTags = []
      }

      let availableLabels: LabelItem[] = []
      let assignedLabelIds: string[] = []
      try {
        const labelsQuery = new URLSearchParams()
        labelsQuery.set('entityId', entityId)
        if (entityOrganizationId) {
          labelsQuery.set('organizationId', entityOrganizationId)
        }
        const labelsCall = await apiCall<{
          items?: LabelItem[]
          assignedIds?: string[]
        }>(`/api/customers/labels?${labelsQuery.toString()}`, {
          cache: 'no-store',
          headers: { 'x-om-unauthorized-redirect': '0' },
        })
        const labelsData = labelsCall.ok ? labelsCall.result : null
        availableLabels = labelsData?.items ?? []
        assignedLabelIds = labelsData?.assignedIds ?? []
      } catch {
        availableLabels = []
        assignedLabelIds = []
      }

      const categoryDefs = buildApplicableCategories(entityType)
      const loadedCategories: CategorySection[] = []

      for (const categoryDef of categoryDefs) {
        if (categoryDef.source === 'tags') {
          loadedCategories.push({
            ...categoryDef,
            label: t(categoryDef.labelKey, categoryDef.labelFallback),
            description: t(categoryDef.descriptionKey, categoryDef.descriptionFallback),
            entries: sortOptions(availableTags),
            selectionMode: categoryDef.selectionMode ?? 'multi',
          })
          continue
        }

        if (categoryDef.source === 'labels') {
          loadedCategories.push({
            ...categoryDef,
            label: t(categoryDef.labelKey, categoryDef.labelFallback),
            description: t(categoryDef.descriptionKey, categoryDef.descriptionFallback),
            entries: sortOptions(
              availableLabels.map((label) => ({
                id: label.id,
                value: label.id,
                label: label.label,
                color: null,
              })),
            ),
            selectionMode: categoryDef.selectionMode ?? 'multi',
          })
          continue
        }

        try {
          const dictionaryUrl = new URL(`/api/customers/dictionaries/${categoryDef.routeKind}`, 'http://localhost')
          if (entityOrganizationId) {
            dictionaryUrl.searchParams.set('organizationId', entityOrganizationId)
          }
          const dictionaryCall = await apiCall<{ items?: DictEntry[] }>(
            `${dictionaryUrl.pathname}${dictionaryUrl.search}`,
            { cache: 'no-store', headers: { 'x-om-unauthorized-redirect': '0' } },
          )
          const dictionaryItems = dictionaryCall.ok ? dictionaryCall.result?.items ?? [] : []
          const entries = dictionaryItems.map((entry) => ({
            id: entry.id,
            value: entry.value,
            label: entry.label,
            color: entry.color ?? null,
          }))
          const currentValue = categoryDef.entityField ? entityData[categoryDef.entityField] : null
          if (
            typeof currentValue === 'string'
            && currentValue.trim().length > 0
            && !entries.some((entry) => entry.value === currentValue.trim())
          ) {
            entries.push({
              id: `current:${categoryDef.kind}:${currentValue.trim()}`,
              value: currentValue.trim(),
              label: currentValue.trim(),
              color: null,
            })
          }
          const setting = categoryDef.settingKind
            ? settingsMap.get(categoryDef.settingKind)
            : undefined
          loadedCategories.push({
            ...categoryDef,
            label: t(categoryDef.labelKey, categoryDef.labelFallback),
            description: t(categoryDef.descriptionKey, categoryDef.descriptionFallback),
            entries: sortOptions(entries),
            selectionMode: setting?.selectionMode ?? categoryDef.selectionMode ?? 'single',
          })
        } catch {
          const currentValue = categoryDef.entityField ? entityData[categoryDef.entityField] : null
          const fallbackEntries =
            typeof currentValue === 'string' && currentValue.trim().length > 0
              ? [{
                  id: `current:${categoryDef.kind}:${currentValue.trim()}`,
                  value: currentValue.trim(),
                  label: currentValue.trim(),
                  color: null,
                }]
              : []
          const setting = categoryDef.settingKind
            ? settingsMap.get(categoryDef.settingKind)
            : undefined
          loadedCategories.push({
            ...categoryDef,
            label: t(categoryDef.labelKey, categoryDef.labelFallback),
            description: t(categoryDef.descriptionKey, categoryDef.descriptionFallback),
            entries: fallbackEntries,
            selectionMode: setting?.selectionMode ?? categoryDef.selectionMode ?? 'single',
          })
        }
      }

      loadedCategories.sort((left, right) => {
        const leftSortOrder =
          left.settingKind && settingsMap.has(left.settingKind)
            ? settingsMap.get(left.settingKind)?.sortOrder ?? 1000
            : 1000 + CATEGORY_DEFS.findIndex((category) => category.kind === left.kind)
        const rightSortOrder =
          right.settingKind && settingsMap.has(right.settingKind)
            ? settingsMap.get(right.settingKind)?.sortOrder ?? 1000
            : 1000 + CATEGORY_DEFS.findIndex((category) => category.kind === right.kind)
        return leftSortOrder - rightSortOrder
      })

      const initialValues: Record<string, Set<string>> = {}
      for (const category of loadedCategories) {
        if (category.source === 'dictionary' && category.entityField) {
          const currentValue = entityData[category.entityField]
          initialValues[category.kind] =
            typeof currentValue === 'string' && currentValue.trim().length > 0
              ? new Set([currentValue.trim()])
              : new Set()
          continue
        }
        if (category.source === 'tags') {
          const availableTagIds = new Set(category.entries.map((entry) => entry.value))
          const assignedTagIds = Array.isArray(entityData.tags)
            ? entityData.tags
                .map((tag) => tag.id)
                .filter((tagId) => availableTagIds.has(tagId))
            : []
          initialValues[category.kind] = new Set(assignedTagIds)
          continue
        }
        if (category.source === 'labels') {
          const availableLabelIds = new Set(category.entries.map((entry) => entry.value))
          initialValues[category.kind] = new Set(
            assignedLabelIds.filter((labelId) => availableLabelIds.has(labelId)),
          )
          continue
        }
        initialValues[category.kind] = new Set()
      }

      setCategories(loadedCategories)
      setSelectedValues(initialValues)
      setOriginalValues(cloneSelectionMap(initialValues))
      setActiveCategoryKind((previous) => {
        if (previous && loadedCategories.some((category) => category.kind === previous)) {
          return previous
        }
        return loadedCategories[0]?.kind ?? null
      })
    } finally {
      setLoading(false)
    }
  }, [entityData, entityId, entityOrganizationId, entityType, t])

  React.useEffect(() => {
    if (!open) return
    setSearchValue('')
    setNewEntryInputByKind({})
    loadData().catch(() => {})
  }, [loadData, open])

  React.useEffect(() => {
    if (open) return
    setManageTagsOpen(false)
  }, [open])

  const activeCategory = React.useMemo(() => {
    if (!categories.length) return null
    return categories.find((category) => category.kind === activeCategoryKind) ?? categories[0]
  }, [activeCategoryKind, categories])

  const activeCount = React.useMemo(
    () => Object.values(selectedValues).reduce((count, values) => count + values.size, 0),
    [selectedValues],
  )

  const hasChanges = React.useMemo(() => {
    const kinds = new Set([
      ...Object.keys(selectedValues),
      ...Object.keys(originalValues),
    ])
    for (const kind of kinds) {
      const current = selectedValues[kind] ?? new Set<string>()
      const original = originalValues[kind] ?? new Set<string>()
      if (current.size !== original.size) return true
      for (const value of current) {
        if (!original.has(value)) return true
      }
    }
    return false
  }, [originalValues, selectedValues])

  const filteredEntries = React.useMemo(() => {
    if (!activeCategory) return []
    const query = searchValue.trim().toLowerCase()
    if (!query) return activeCategory.entries
    return activeCategory.entries.filter((entry) =>
      entry.label.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query),
    )
  }, [activeCategory, searchValue])

  const toggleValue = React.useCallback(
    (kind: string, value: string, selectionMode: 'single' | 'multi') => {
      setSelectedValues((previous) => {
        const next = new Set(previous[kind] ?? [])
        if (next.has(value)) {
          next.delete(value)
        } else {
          if (selectionMode === 'single') {
            next.clear()
          }
          next.add(value)
        }
        return { ...previous, [kind]: next }
      })
    },
    [],
  )

  const handleCreateEntry = React.useCallback(async () => {
    if (!activeCategory || !activeCategory.supportsCreate) return
    const draftValue = newEntryInputByKind[activeCategory.kind] ?? ''
    const trimmed = draftValue.trim()
    if (!trimmed || creatingKind || creationInFlightRef.current) {
      if (!trimmed) {
        setNewEntryInputByKind((previous) => ({ ...previous, [activeCategory.kind]: null }))
      }
      return
    }

    const existingEntry = activeCategory.entries.find(
      (entry) => entry.label.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (existingEntry) {
      setSelectedValues((previous) => {
        const current = new Set(previous[activeCategory.kind] ?? [])
        current.add(existingEntry.value)
        return { ...previous, [activeCategory.kind]: current }
      })
      setNewEntryInputByKind((previous) => ({ ...previous, [activeCategory.kind]: null }))
      return
    }

    creationInFlightRef.current = activeCategory.kind
    setCreatingKind(activeCategory.kind)
    try {
      if (activeCategory.source === 'tags') {
        const result = await runGuardedMutation(
          () =>
            readApiResultOrThrow<Record<string, unknown>>(
              '/api/customers/tags',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  label: trimmed,
                  slug: slugifyTagLabel(trimmed),
                }),
              },
            ),
          { categoryKind: activeCategory.kind, operation: 'createTag', label: trimmed },
        )
        const id = typeof result?.id === 'string' ? result.id : ''
        if (!id) {
          throw new Error(t('customers.people.detail.tags.createError', 'Failed to create tag.'))
        }
        const option: CategoryOption = {
          id,
          value: id,
          label: trimmed,
          color: typeof result?.color === 'string' ? result.color : null,
        }
        updateCategoryEntries(activeCategory.kind, (entries) => [...entries, option])
        setSelectedValues((previous) => ({
          ...previous,
          [activeCategory.kind]: new Set([...(previous[activeCategory.kind] ?? []), option.value]),
        }))
      } else if (activeCategory.source === 'labels') {
        const payload = entityOrganizationId
          ? { label: trimmed, organizationId: entityOrganizationId }
          : { label: trimmed }
        const result = await runGuardedMutation(
          () =>
            readApiResultOrThrow<{ id: string; slug: string; label: string }>(
              '/api/customers/labels',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
            ),
          { categoryKind: activeCategory.kind, operation: 'createLabel', label: trimmed },
        )
        const option: CategoryOption = {
          id: result.id,
          value: result.id,
          label: result.label,
          color: null,
        }
        updateCategoryEntries(activeCategory.kind, (entries) => [...entries, option])
        setSelectedValues((previous) => ({
          ...previous,
          [activeCategory.kind]: new Set([...(previous[activeCategory.kind] ?? []), option.value]),
        }))
      }
      setNewEntryInputByKind((previous) => ({ ...previous, [activeCategory.kind]: null }))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.personTags.createLabelError', 'Failed to create label')
      flash(message, 'error')
    } finally {
      creationInFlightRef.current = null
      setCreatingKind(null)
    }
  }, [activeCategory, creatingKind, entityOrganizationId, newEntryInputByKind, runGuardedMutation, t, updateCategoryEntries])

  const handleSave = React.useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const entityUpdate: Record<string, string | null> = {}
      categories.forEach((category) => {
        if (category.source !== 'dictionary' || !category.entityField) return
        const currentSelection = selectedValues[category.kind] ?? new Set<string>()
        const originalSelection = originalValues[category.kind] ?? new Set<string>()
        const currentValue = currentSelection.size > 0 ? Array.from(currentSelection)[0] ?? null : null
        const originalValue = originalSelection.size > 0 ? Array.from(originalSelection)[0] ?? null : null
        if (currentValue !== originalValue) {
          entityUpdate[category.entityField] = currentValue
        }
      })

      if (Object.keys(entityUpdate).length > 0) {
        await runGuardedMutation(
          () =>
            apiCallOrThrow(`/api/customers/${entityType === 'person' ? 'people' : 'companies'}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: entityId, ...entityUpdate }),
            }),
          { operation: 'updateEntityTags', entityUpdate },
        )
      }

      const currentTags = selectedValues.tags ?? new Set<string>()
      const originalTags = originalValues.tags ?? new Set<string>()
      const addedTags = Array.from(currentTags).filter((tagId) => !originalTags.has(tagId))
      const removedTags = Array.from(originalTags).filter((tagId) => !currentTags.has(tagId))

      for (const tagId of addedTags) {
        await runGuardedMutation(
          () =>
            apiCallOrThrow('/api/customers/tags/assign', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tagId, entityId }),
            }),
          { operation: 'assignTag', tagId },
        )
      }

      for (const tagId of removedTags) {
        await runGuardedMutation(
          () =>
            apiCallOrThrow('/api/customers/tags/unassign', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tagId, entityId }),
            }),
          { operation: 'unassignTag', tagId },
        )
      }

      const currentLabels = selectedValues.labels ?? new Set<string>()
      const originalLabels = originalValues.labels ?? new Set<string>()
      const addedLabels = Array.from(currentLabels).filter((labelId) => !originalLabels.has(labelId))
      const removedLabels = Array.from(originalLabels).filter((labelId) => !currentLabels.has(labelId))

      for (const labelId of addedLabels) {
        const payload = entityOrganizationId
          ? { labelId, entityId, organizationId: entityOrganizationId }
          : { labelId, entityId }
        await runGuardedMutation(
          () =>
            apiCallOrThrow('/api/customers/labels/assign', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          { operation: 'assignLabel', labelId },
        )
      }

      for (const labelId of removedLabels) {
        const payload = entityOrganizationId
          ? { labelId, entityId, organizationId: entityOrganizationId }
          : { labelId, entityId }
        await runGuardedMutation(
          () =>
            apiCallOrThrow('/api/customers/labels/unassign', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          { operation: 'unassignLabel', labelId },
        )
      }

      flash(t('customers.personTags.saveSuccess', 'Tags updated.'), 'success')
      onSaved?.()
      onClose()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.personTags.saveError', 'Failed to save tags')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [
    categories,
    entityId,
    entityOrganizationId,
    entityType,
    onClose,
    onSaved,
    originalValues,
    saving,
    selectedValues,
    runGuardedMutation,
    t,
  ])

  React.useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, open])

  React.useEffect(() => {
    if (!open) return
    setSearchValue('')
  }, [activeCategoryKind, open])

  const activeSelection = activeCategory
    ? selectedValues[activeCategory.kind] ?? new Set<string>()
    : new Set<string>()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden border-border bg-background p-0 shadow-[0px_16px_40px_0px_rgba(0,0,0,0.14)] sm:max-w-[760px] sm:rounded-[16px] [&>[data-dialog-close]]:hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>{t('customers.personTags.title', 'Edit tags')}</DialogTitle>
        </VisuallyHidden>

        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-[20px] py-[16px]">
          <div className="flex items-center gap-[8px]">
            <Tag className="size-[16px] text-foreground" />
            <span className="text-[15px] font-bold text-foreground">
              {t('customers.personTags.title', 'Edit tags')}
            </span>
          </div>
          <div className="flex items-center gap-[8px]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto gap-[8px] rounded-[12px] px-[14px] py-[8px] text-[13px] font-medium"
              onClick={() => setManageTagsOpen(true)}
            >
              <SlidersHorizontal className="size-[14px]" />
              {t('customers.personTags.settingsButton', 'Tag settings')}
            </Button>
            <IconButton
              type="button"
              variant="outline"
              size="xs"
              className="size-[28px] rounded-[5px] border-border bg-background"
              onClick={onClose}
            >
              <X className="size-[14px]" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          {loading ? (
            <div className="flex h-full items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
              {t('customers.personTags.loading', 'Loading...')}
            </div>
          ) : (
            <div className="flex h-full flex-col gap-4 px-[20px] py-[16px] md:flex-row">
              <div className="flex gap-2 overflow-x-auto pb-1 md:w-[220px] md:shrink-0 md:flex-col md:overflow-x-visible md:pb-0">
                {categories.map((category) => {
                  const count = selectedValues[category.kind]?.size ?? 0
                  const isActive = activeCategory?.kind === category.kind
                  return (
                    <Button
                      key={category.kind}
                      type="button"
                      variant={isActive ? 'secondary' : 'ghost'}
                      size="sm"
                      className={cn(
                        'h-auto min-w-[140px] justify-between rounded-[10px] px-3 py-2 text-left md:w-full',
                        isActive ? 'border border-border bg-muted text-foreground' : 'border border-transparent text-muted-foreground',
                      )}
                      onClick={() => setActiveCategoryKind(category.kind)}
                    >
                      <span className="truncate text-[12px] font-medium">
                        {category.label}
                      </span>
                      <span className="ml-3 shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {count}
                      </span>
                    </Button>
                  )
                })}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-[14px] border border-border bg-card">
                {activeCategory ? (
                  <div className="flex min-h-full flex-col">
                    <div className="border-b border-border px-[18px] py-[16px]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h3 className="text-[14px] font-semibold text-foreground">
                            {activeCategory.label}
                          </h3>
                          <p className="max-w-[520px] text-[12px] leading-5 text-muted-foreground">
                            {activeCategory.description}
                          </p>
                        </div>
                        <div className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground">
                          {t('customers.personTags.activeCount', '{{count}} selected', {
                            count: activeSelection.size,
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 space-y-4 overflow-y-auto px-[18px] py-[16px]">
                      <div className="flex items-center gap-[8px] rounded-[10px] border border-input bg-background px-[12px] py-[9px]">
                        <Search className="size-[14px] shrink-0 text-muted-foreground" />
                        <input
                          type="text"
                          value={searchValue}
                          onChange={(event) => setSearchValue(event.target.value)}
                          placeholder={t(
                            'customers.personTags.searchPlaceholder',
                            'Search {{category}}...',
                            { category: activeCategory.label.toLowerCase() },
                          )}
                          className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                        />
                      </div>

                      {filteredEntries.length > 0 ? (
                        <div className="flex flex-wrap gap-x-[6px] gap-y-[8px]">
                          {filteredEntries.map((entry) => (
                            <TagChip
                              key={`${activeCategory.kind}:${entry.value}`}
                              label={entry.label}
                              color={entry.color}
                              active={activeSelection.has(entry.value)}
                              showColorDot={activeCategory.hasColorDots}
                              onClick={() =>
                                toggleValue(
                                  activeCategory.kind,
                                  entry.value,
                                  activeCategory.selectionMode,
                                )
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[12px] border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                          {searchValue.trim().length > 0
                            ? t('customers.personTags.emptySearchResults', 'No options match the current search.')
                            : activeCategory.source === 'dictionary'
                              ? t('customers.personTags.emptyDictionaryCategory', 'No options are configured for this category yet.')
                              : t('customers.personTags.emptyCategory', 'No items have been added for this category yet.')}
                        </div>
                      )}

                      {activeCategory.supportsCreate ? (
                        <div>
                          {newEntryInputByKind[activeCategory.kind] !== null ? (
                            <div className="inline-flex items-center rounded-full border border-dashed border-lime-400/70 bg-lime-500/5 px-[10px] py-[4px] dark:border-lime-300/40 dark:bg-lime-300/10">
                              <input
                                type="text"
                                autoFocus
                                value={newEntryInputByKind[activeCategory.kind] ?? ''}
                                disabled={creatingKind === activeCategory.kind}
                                onChange={(event) =>
                                  setNewEntryInputByKind((previous) => ({
                                    ...previous,
                                    [activeCategory.kind]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void handleCreateEntry()
                                  }
                                  if (event.key === 'Escape') {
                                    setNewEntryInputByKind((previous) => ({
                                      ...previous,
                                      [activeCategory.kind]: null,
                                    }))
                                  }
                                }}
                                onBlur={() => {
                                  const value = newEntryInputByKind[activeCategory.kind] ?? ''
                                  if (creationInFlightRef.current === activeCategory.kind) {
                                    return
                                  }
                                  if (value.trim()) {
                                    void handleCreateEntry()
                                  } else {
                                    setNewEntryInputByKind((previous) => ({
                                      ...previous,
                                      [activeCategory.kind]: null,
                                    }))
                                  }
                                }}
                                placeholder={
                                  activeCategory.kind === 'tags'
                                    ? t('customers.people.detail.tags.placeholder', 'Type to add tags')
                                    : t('customers.personTags.newLabelPlaceholder', 'Label name...')
                                }
                                className="w-[150px] bg-transparent text-[12px] font-semibold text-lime-700 outline-none placeholder:text-lime-700/60 disabled:cursor-wait disabled:opacity-70 dark:text-lime-300 dark:placeholder:text-lime-300/60"
                              />
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={creatingKind === activeCategory.kind}
                              onClick={() =>
                                setNewEntryInputByKind((previous) => ({
                                  ...previous,
                                  [activeCategory.kind]: '',
                                }))
                              }
                              className="inline-flex h-auto items-center gap-[4px] rounded-full border border-dashed border-lime-400/70 bg-transparent px-[10px] py-[6px] font-semibold text-lime-700 hover:bg-lime-500/10 disabled:opacity-60 dark:border-lime-300/40 dark:text-lime-300 dark:hover:bg-lime-300/10"
                            >
                              <Plus className="size-[10px]" />
                              <span className="text-[12px]">
                                {activeCategory.kind === 'tags'
                                  ? t('customers.personTags.newTag', 'New tag')
                                  : t('customers.personTags.newLabel', 'New label')}
                              </span>
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
                    {t('customers.personTags.emptyCategory', 'No items have been added for this category yet.')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/20 px-[20px] py-[14px]">
          <span className="text-[12px] text-muted-foreground">
            {t('customers.personTags.activeCount', '{{count}} selected', { count: activeCount })}
          </span>
          <div className="flex items-center gap-[24px]">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-[8px] border-border bg-background px-[16px] py-[9px] text-[13px] font-semibold text-foreground"
            >
              {t('customers.personTags.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => { void handleSave() }}
              disabled={saving || !hasChanges}
              className="rounded-[8px] bg-foreground px-[18px] py-[9px] text-[13px] font-semibold text-background hover:bg-foreground/90"
            >
              <Check className="mr-[8px] size-[14px]" />
              {saving
                ? t('customers.personTags.saving', 'Saving...')
                : t('customers.personTags.save', 'Save')}
            </Button>
          </div>
        </div>
      </DialogContent>

      <ManageTagsDialog
        open={manageTagsOpen}
        onClose={() => {
          setManageTagsOpen(false)
          void loadData()
        }}
      />
    </Dialog>
  )
}
