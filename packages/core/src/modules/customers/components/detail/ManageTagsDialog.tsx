'use client'

import * as React from 'react'
import {
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Check,
  GripVertical,
  Hash,
  Info,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Tag,
  Thermometer,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TagEntryDraft = {
  localId: string
  id: string | null
  value: string
  label: string
  color: string
  icon: string
  isDefault: boolean
  isInherited: boolean
  manualValue: boolean
  deleted: boolean
}

type KindSetting = {
  kind: string
  selectionMode: 'single' | 'multi'
  visibleInTags: boolean
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Category definitions — maps to /api/customers/dictionaries/{kind}
// ---------------------------------------------------------------------------

type CategoryDef = {
  kind: string // route param for /api/customers/dictionaries/{kind}
  icon: React.ComponentType<{ className?: string }>
  shortLabelKey: string
  shortLabelFallback: string
  descriptionKey: string
  descriptionFallback: string
  badges?: string[]
  noteTitleKey: string
  noteTitleFallback: string
  noteDescriptionKey: string
  noteDescriptionFallback: string
  isCustom?: boolean
}

const BUILTIN_CATEGORIES: CategoryDef[] = [
  {
    kind: 'statuses',
    icon: Tag,
    shortLabelKey: 'customers.personTags.category.statuses',
    shortLabelFallback: 'Status',
    descriptionKey: 'customers.tags.manage.description.customers.status',
    descriptionFallback: 'Single-select values visible on the hero area of person, company, and deal cards.',
    badges: ['system', 'required'],
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.status',
    noteTitleFallback: 'System category',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.status',
    noteDescriptionFallback:
      'Status is required on customer cards. Existing rows can be edited, but this category should remain available tenant-wide.',
  },
  {
    kind: 'lifecycle-stages',
    icon: RefreshCw,
    shortLabelKey: 'customers.personTags.category.lifecycle-stages',
    shortLabelFallback: 'Lifecycle',
    descriptionKey: 'customers.tags.manage.description.customers.lifecycle_stage',
    descriptionFallback: 'Pipeline-aligned lifecycle values shared across CRM detail pages.',
    badges: ['system'],
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.lifecycle_stage',
    noteTitleFallback: 'Shared lifecycle values',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.lifecycle_stage',
    noteDescriptionFallback:
      'Use lifecycle stages to keep person and company headers visually consistent across CRM detail views.',
  },
  {
    kind: 'sources',
    icon: Radio,
    shortLabelKey: 'customers.personTags.category.sources',
    shortLabelFallback: 'Source',
    descriptionKey: 'customers.tags.manage.description.customers.source',
    descriptionFallback: 'Acquisition source labels used in Zone 1 forms and CRM summary badges.',
    badges: ['system'],
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.source',
    noteTitleFallback: 'Source dictionary',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.source',
    noteDescriptionFallback: 'These values are reused by customer forms and reporting filters.',
  },
  {
    kind: 'temperature',
    icon: Thermometer,
    shortLabelKey: 'customers.personTags.category.temperature',
    shortLabelFallback: 'Temperature',
    descriptionKey: 'customers.tags.manage.description.customers.temperature',
    descriptionFallback: 'Temperature / interest level for leads and contacts.',
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.temperature',
    noteTitleFallback: 'Temperature / Interest',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.temperature',
    noteDescriptionFallback: 'Use temperature to quickly classify contact interest level from hot to cold.',
  },
  {
    kind: 'renewal-quarters',
    icon: CalendarDays,
    shortLabelKey: 'customers.personTags.category.renewal-quarters',
    shortLabelFallback: 'Renewal',
    descriptionKey: 'customers.tags.manage.description.customers.renewal_quarter',
    descriptionFallback: 'Renewal quarter labels for tracking contract renewal timing.',
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.renewal_quarter',
    noteTitleFallback: 'Renewal quarter',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.renewal_quarter',
    noteDescriptionFallback: 'Assign renewal quarters to track when contracts or subscriptions are up for renewal.',
  },
  {
    kind: 'person-company-roles',
    icon: Users,
    shortLabelKey: 'customers.personTags.category.person-company-roles',
    shortLabelFallback: 'Roles',
    descriptionKey: 'customers.tags.manage.description.customers.person_company_role',
    descriptionFallback: 'Person-company relationship roles such as decision maker, influencer, or budget holder.',
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.person_company_role',
    noteTitleFallback: 'Person-company roles',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.person_company_role',
    noteDescriptionFallback: 'Use roles to classify how a person relates to a company, for example decision maker, technical evaluator, or primary contact.',
  },
  {
    kind: 'activity-types',
    icon: CalendarDays,
    shortLabelKey: 'customers.personTags.category.activity-types',
    shortLabelFallback: 'Activity',
    descriptionKey: 'customers.tags.manage.description.customers.activity_type',
    descriptionFallback: 'Activity types for calls, emails, meetings, and other CRM interactions.',
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.activity_type',
    noteTitleFallback: 'Activity types',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.activity_type',
    noteDescriptionFallback: 'Keep activity type names consistent so timeline filters remain readable across CRM views.',
  },
  {
    kind: 'deal-statuses',
    icon: Tag,
    shortLabelKey: 'customers.personTags.category.deal-statuses',
    shortLabelFallback: 'Deal status',
    descriptionKey: 'customers.tags.manage.description.customers.deal_status',
    descriptionFallback: 'Deal status labels used in pipeline views and deal detail cards.',
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.deal_status',
    noteTitleFallback: 'Deal statuses',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.deal_status',
    noteDescriptionFallback: 'Deal status values affect pipeline filtering and reporting groupings.',
  },
  {
    kind: 'industries',
    icon: Hash,
    shortLabelKey: 'customers.personTags.category.industries',
    shortLabelFallback: 'Industry',
    descriptionKey: 'customers.config.dictionaries.sections.industries.description',
    descriptionFallback: 'Industry classification labels for companies and contacts.',
    noteTitleKey: 'customers.tags.manage.noteTitle.customers.industry',
    noteTitleFallback: 'Industry labels',
    noteDescriptionKey: 'customers.tags.manage.noteDescription.customers.industry',
    noteDescriptionFallback: 'Add industry categories that match your target market segments for consistent CRM classification.',
  },
]

const BUILTIN_CATEGORY_KINDS = new Set(BUILTIN_CATEGORIES.map((category) => category.kind))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `draft-${Math.random().toString(36).slice(2)}`
}

function normalizeColor(value: string | null | undefined): string {
  if (typeof value !== 'string') return '#D1D5DB'
  const trimmed = value.trim()
  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) {
    return `#${trimmed.slice(1).toLowerCase()}`
  }
  return '#D1D5DB'
}

function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sanitizeIcon(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function humanizeCategoryKind(kind: string): string {
  return kind
    .split(/[-_]+/)
    .filter((part) => part.trim().length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function createCustomCategoryDef(kind: string): CategoryDef {
  const label = humanizeCategoryKind(kind)
  return {
    kind,
    icon: Hash,
    shortLabelKey: '',
    shortLabelFallback: label,
    descriptionKey: 'customers.tags.manage.customCategoryDescription',
    descriptionFallback: `Custom CRM category: ${label}.`,
    noteTitleKey: 'customers.tags.manage.customCategoryNoteTitle',
    noteTitleFallback: 'Custom category',
    noteDescriptionKey: 'customers.tags.manage.customCategoryNoteDescription',
    noteDescriptionFallback: 'Use this category to group and manage additional CRM values for your team.',
    isCustom: true,
  }
}

function makeDraftEntry(entry: Record<string, unknown>): TagEntryDraft | null {
  const id = typeof entry.id === 'string' ? entry.id : null
  const value = typeof entry.value === 'string' ? entry.value.trim() : ''
  if (!value.length) return null
  return {
    localId: id ?? createLocalId(),
    id,
    value,
    label:
      typeof entry.label === 'string' && entry.label.trim().length
        ? entry.label.trim()
        : value,
    color: normalizeColor(typeof entry.color === 'string' ? entry.color : null),
    icon: sanitizeIcon(typeof entry.icon === 'string' ? entry.icon : null),
    isDefault: false,
    isInherited: typeof entry.isInherited === 'boolean' ? entry.isInherited : false,
    manualValue: true,
    deleted: false,
  }
}

function cloneDrafts(entries: TagEntryDraft[]): TagEntryDraft[] {
  return entries.map((entry) => ({ ...entry }))
}

function serializeEntries(entries: TagEntryDraft[]): string {
  return JSON.stringify(
    entries
      .filter((entry) => !entry.deleted)
      .map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
      })),
  )
}

// ---------------------------------------------------------------------------
// Sortable entry row
// ---------------------------------------------------------------------------

function SortableEntryRow({
  entry,
  isDefault,
  onLabelChange,
  onValueChange,
  onColorChange,
  onDelete,
  t,
}: {
  entry: TagEntryDraft
  isDefault: boolean
  onLabelChange: (value: string) => void
  onValueChange: (value: string) => void
  onColorChange: (value: string) => void
  onDelete: () => void
  t: ReturnType<typeof useT>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.localId,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-[10px] rounded-[6px] border border-border bg-card px-[10px] py-[8px]"
    >
      {/* Grip handle */}
      <div
        className="flex size-[18px] shrink-0 cursor-grab items-center justify-center text-muted-foreground/70"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-[14px]" />
      </div>

      {/* Label + default indicator */}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <input
          type="text"
          value={entry.label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="w-full rounded-[5px] border border-input bg-background px-[12px] py-[7px] text-[13px] font-medium text-foreground outline-none focus:border-foreground"
        />
        {isDefault && (
          <div className="flex items-center gap-[5px]">
            <Check className="size-[10px] text-green-500" />
            <span className="text-[10px] text-muted-foreground">
              {t('customers.tags.manage.defaultEntry', 'default when creating new records')}
            </span>
          </div>
        )}
      </div>

      {/* Slug (read-only style) */}
      <div className="w-[140px] shrink-0">
        <input
          type="text"
          value={entry.value}
          onChange={(e) => onValueChange(slugifyLabel(e.target.value))}
          className="w-full rounded-[5px] bg-muted px-[10px] py-[7px] text-[11px] font-medium text-muted-foreground outline-none"
        />
      </div>

      {/* Color picker */}
      <div className="flex w-[80px] shrink-0 items-center gap-[6px] rounded-[5px] border border-input px-[8px] py-[6px]">
        <label className="relative size-[16px] shrink-0 cursor-pointer">
          <span
            className="block size-full rounded-[3px]"
            style={{ backgroundColor: normalizeColor(entry.color) }}
          />
          <input
            type="color"
            value={normalizeColor(entry.color)}
            onChange={(e) => onColorChange(normalizeColor(e.target.value))}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <span className="text-[10px] font-medium text-muted-foreground">
          {normalizeColor(entry.color)}
        </span>
      </div>

      {/* Delete */}
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        className="size-[32px] shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        aria-label={t('customers.tags.manage.delete', 'Delete')}
      >
        <Trash2 className="size-[14px]" />
      </IconButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

interface ManageTagsDialogProps {
  open: boolean
  onClose: () => void
}

export function ManageTagsDialog({ open, onClose }: ManageTagsDialogProps) {
  const t = useT()
  const [categories, setCategories] = React.useState<CategoryDef[]>(BUILTIN_CATEGORIES)
  const [activeTab, setActiveTab] = React.useState(BUILTIN_CATEGORIES[0].kind)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState('')
  const [entryCounts, setEntryCounts] = React.useState<Record<string, number>>({})
  const [draftsByKind, setDraftsByKind] = React.useState<Record<string, TagEntryDraft[]>>({})
  const [originalByKind, setOriginalByKind] = React.useState<Record<string, TagEntryDraft[]>>({})
  const [createCategoryOpen, setCreateCategoryOpen] = React.useState(false)
  const [newCategoryName, setNewCategoryName] = React.useState('')
  const [newCategorySelectionMode, setNewCategorySelectionMode] = React.useState<'single' | 'multi'>('multi')
  const [creatingCategory, setCreatingCategory] = React.useState(false)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)
  const categoryRailRef = React.useRef<HTMLDivElement | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-manage-tags',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: 'customers-manage-tags',
      resourceKind: 'customers.dictionary_entry',
      resourceId: 'bulk',
      retryLastMutation,
    }),
    [retryLastMutation],
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
  const translatedCategories = React.useMemo(
    () =>
      categories.map((category) => ({
        ...category,
        shortLabel: category.shortLabelKey
          ? t(category.shortLabelKey, category.shortLabelFallback)
          : category.shortLabelFallback,
        description: category.descriptionKey
          ? t(
            category.descriptionKey,
            category.descriptionFallback,
            category.isCustom ? { name: category.shortLabelFallback } : undefined,
          )
          : category.descriptionFallback,
        noteTitle: category.noteTitleKey
          ? t(category.noteTitleKey, category.noteTitleFallback)
          : category.noteTitleFallback,
        noteDescription: category.noteDescriptionKey
          ? t(category.noteDescriptionKey, category.noteDescriptionFallback)
          : category.noteDescriptionFallback,
      })),
    [categories, t],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  // --- data loading ---

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      let kindSettings: KindSetting[] = []
      try {
        const settings = await readApiResultOrThrow<{ items?: KindSetting[] }>(
          '/api/customers/dictionaries/kind-settings',
          { cache: 'no-store' },
        )
        kindSettings = Array.isArray(settings?.items) ? settings.items : []
      } catch {
        kindSettings = []
      }

      const customCategories = kindSettings
        .filter((setting) => !BUILTIN_CATEGORY_KINDS.has(setting.kind))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.kind.localeCompare(right.kind))
        .map((setting) => createCustomCategoryDef(setting.kind))
      const resolvedCategories = [...BUILTIN_CATEGORIES, ...customCategories]

      const loadedDrafts: Record<string, TagEntryDraft[]> = {}
      const counts: Record<string, number> = {}

      for (const category of resolvedCategories) {
        try {
          const data = await readApiResultOrThrow<{
            items?: Array<Record<string, unknown>>
          }>(`/api/customers/dictionaries/${category.kind}`, { cache: 'no-store' })
          const entries = Array.isArray(data?.items)
            ? data.items
                .map(makeDraftEntry)
                .filter((entry): entry is TagEntryDraft => entry !== null)
            : []
          loadedDrafts[category.kind] = entries
          counts[category.kind] = entries.length
        } catch {
          loadedDrafts[category.kind] = []
          counts[category.kind] = 0
        }
      }

      setCategories(resolvedCategories)
      setDraftsByKind(
        Object.fromEntries(
          Object.entries(loadedDrafts).map(([k, v]) => [k, cloneDrafts(v)]),
        ),
      )
      setOriginalByKind(
        Object.fromEntries(
          Object.entries(loadedDrafts).map(([k, v]) => [k, cloneDrafts(v)]),
        ),
      )
      setEntryCounts(counts)
      setActiveTab((current) =>
        resolvedCategories.some((category) => category.kind === current)
          ? current
          : resolvedCategories[0]?.kind ?? BUILTIN_CATEGORIES[0].kind,
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.tags.manage.loadError', 'Failed to load tag dictionaries.')
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    setSearchValue('')
    setCreateCategoryOpen(false)
    setNewCategoryName('')
    setNewCategorySelectionMode('multi')
    loadData().catch(() => {})
  }, [loadData, open])

  // --- derived state ---

  const activeMeta = translatedCategories.find((category) => category.kind === activeTab) ?? null
  const activeEntries = draftsByKind[activeTab] ?? []
  const visibleEntries = React.useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    return activeEntries.filter((entry) => {
      if (entry.deleted) return false
      if (!query) return true
      return (
        entry.label.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query)
      )
    })
  }, [activeEntries, searchValue])

  const hasChanges = React.useMemo(
    () =>
      categories.some((category) => {
        const original = originalByKind[category.kind] ?? []
        const current = draftsByKind[category.kind] ?? []
        return serializeEntries(original) !== serializeEntries(current)
      }),
    [categories, draftsByKind, originalByKind],
  )

  // --- draft mutations ---

  const updateDraftEntry = React.useCallback(
    (kind: string, localId: string, updater: (e: TagEntryDraft) => TagEntryDraft) => {
      setDraftsByKind((current) => ({
        ...current,
        [kind]: (current[kind] ?? []).map((entry) =>
          entry.localId === localId ? updater(entry) : entry,
        ),
      }))
    },
    [],
  )

  const handleAddEntry = React.useCallback(() => {
    setDraftsByKind((current) => ({
      ...current,
      [activeTab]: [
        ...(current[activeTab] ?? []),
        {
          localId: createLocalId(),
          id: null,
          value: '',
          label: '',
          color: '#D1D5DB',
          icon: '',
          isDefault: false,
          isInherited: false,
          manualValue: false,
          deleted: false,
        },
      ],
    }))
  }, [activeTab])

  const handleDeleteEntry = React.useCallback(
    (kind: string, localId: string) => {
      setDraftsByKind((current) => {
        const nextEntries = (current[kind] ?? [])
          .map((entry) => {
            if (entry.localId !== localId) return entry
            if (!entry.id) return null
            return { ...entry, deleted: true }
          })
          .filter((entry): entry is TagEntryDraft => entry !== null)
        return { ...current, [kind]: nextEntries }
      })
    },
    [],
  )

  // --- drag & drop ---

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      setDraftsByKind((current) => {
        const entries = current[activeTab] ?? []
        const liveEntries = entries.filter((e) => !e.deleted)
        const oldIndex = liveEntries.findIndex((e) => e.localId === active.id)
        const newIndex = liveEntries.findIndex((e) => e.localId === over.id)
        if (oldIndex === -1 || newIndex === -1) return current
        const reordered = arrayMove(liveEntries, oldIndex, newIndex)
        const deletedEntries = entries.filter((e) => e.deleted)
        return { ...current, [activeTab]: [...reordered, ...deletedEntries] }
      })
    },
    [activeTab],
  )

  // --- save ---

  const handleSave = React.useCallback(async () => {
    if (saving) return

    for (const category of categories) {
      const entries = draftsByKind[category.kind] ?? []
      for (const entry of entries) {
        if (entry.deleted) continue
        const nextLabel = entry.label.trim()
        const nextValue = entry.value.trim()
        if (!nextLabel || !nextValue) {
          flash(
            t(
              'customers.tags.manage.validation.required',
              'Each entry must have both a label and a slug before saving.',
            ),
            'error',
          )
          return
        }
      }
    }

    setSaving(true)
    try {
      for (const category of categories) {
        const currentEntries = draftsByKind[category.kind] ?? []
        const originalEntries = originalByKind[category.kind] ?? []
        const originalById = new Map(
          originalEntries.filter((e) => e.id).map((e) => [e.id as string, e]),
        )

        for (const entry of currentEntries) {
          if (entry.deleted) {
            if (entry.id) {
              await runGuardedMutation(
                () =>
                  apiCallOrThrow(`/api/customers/dictionaries/${category.kind}/${entry.id}`, {
                    method: 'DELETE',
                  }),
                { kind: category.kind, entryId: entry.id, operation: 'delete' },
              )
            }
            continue
          }

          const payload: Record<string, unknown> = {
            value: entry.value.trim(),
            label: entry.label.trim(),
            color: normalizeColor(entry.color),
            icon: sanitizeIcon(entry.icon) || null,
          }

          if (!entry.id) {
            await runGuardedMutation(
              () =>
                apiCallOrThrow(`/api/customers/dictionaries/${category.kind}`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(payload),
                }),
              { kind: category.kind, value: payload.value, operation: 'create' },
            )
            continue
          }

          // Skip inherited entries — they belong to a parent org and can't be PATCHed
          if (entry.isInherited) continue

          const originalEntry = originalById.get(entry.id)
          if (
            originalEntry &&
            originalEntry.value === (payload.value as string) &&
            originalEntry.label === (payload.label as string) &&
            normalizeColor(originalEntry.color) === normalizeColor(payload.color as string) &&
            sanitizeIcon(originalEntry.icon) === sanitizeIcon(payload.icon as string)
          ) {
            continue
          }

          await runGuardedMutation(
            () =>
              apiCallOrThrow(`/api/customers/dictionaries/${category.kind}/${entry.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              }),
            { kind: category.kind, entryId: entry.id, value: payload.value, operation: 'update' },
          )
        }
      }

      flash(t('customers.tags.manage.saveSuccess', 'Tag dictionaries updated.'), 'success')
      await loadData()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.tags.manage.saveError', 'Failed to save tag dictionaries.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [categories, draftsByKind, loadData, originalByKind, runGuardedMutation, saving, t])

  const updateCategoryRailState = React.useCallback(() => {
    const rail = categoryRailRef.current
    if (!rail) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth)
    setCanScrollLeft(rail.scrollLeft > 4)
    setCanScrollRight(rail.scrollLeft < maxScrollLeft - 4)
  }, [])

  const scrollCategoryRail = React.useCallback(
    (direction: 'left' | 'right') => {
      const rail = categoryRailRef.current
      if (!rail) return
      const offset = Math.max(180, Math.round(rail.clientWidth * 0.65))
      rail.scrollBy({
        left: direction === 'left' ? -offset : offset,
        behavior: 'smooth',
      })
    },
    [],
  )

  React.useEffect(() => {
    if (!open) return
    const rail = categoryRailRef.current
    if (!rail) return
    updateCategoryRailState()
    rail.addEventListener('scroll', updateCategoryRailState, { passive: true })
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateCategoryRailState())
        : null
    resizeObserver?.observe(rail)
    return () => {
      rail.removeEventListener('scroll', updateCategoryRailState)
      resizeObserver?.disconnect()
    }
  }, [open, translatedCategories, updateCategoryRailState])

  const handleCreateCategory = React.useCallback(async () => {
    if (creatingCategory) return
    const trimmedName = newCategoryName.trim()
    const kind = slugifyLabel(trimmedName)
    if (!kind.length) {
      flash(
        t('customers.tags.manage.addCategoryRequired', 'Enter a category name first.'),
        'error',
      )
      return
    }
    if (categories.some((category) => category.kind === kind)) {
      setActiveTab(kind)
      setCreateCategoryOpen(false)
      return
    }

    setCreatingCategory(true)
    try {
      await runGuardedMutation(
        () =>
          apiCallOrThrow('/api/customers/dictionaries/kind-settings', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind,
              selectionMode: newCategorySelectionMode,
              visibleInTags: true,
              sortOrder: categories.length + 1,
            }),
          }),
        {
          kind,
          selectionMode: newCategorySelectionMode,
          operation: 'createCategory',
        },
      )
      await loadData()
      setActiveTab(kind)
      setCreateCategoryOpen(false)
      setNewCategoryName('')
      setNewCategorySelectionMode('multi')
      flash(t('customers.tags.manage.createCategorySuccess', 'Category created.'), 'success')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.tags.manage.createCategoryError', 'Failed to create category.')
      flash(message, 'error')
    } finally {
      setCreatingCategory(false)
    }
  }, [categories, creatingCategory, loadData, newCategoryName, newCategorySelectionMode, runGuardedMutation, t])

  // --- keyboard shortcut ---

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, handleSave])

  // --- render ---

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden border-border p-0 shadow-[0px_20px_48px_0px_rgba(0,0,0,0.18)] sm:max-w-[820px] sm:rounded-[12px] [&>[data-dialog-close]]:hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>{t('customers.tags.manage.title', 'Manage tags')}</DialogTitle>
        </VisuallyHidden>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between pb-[10px] pl-[24px] pr-[20px] pt-[16px]">
          <div className="flex flex-col gap-[3px]">
            <h2 className="text-[16px] font-bold leading-tight text-foreground">
              {t('customers.tags.manage.title', 'Manage tags')}
            </h2>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {t(
                'customers.tags.manage.subtitle',
                'Tag dictionaries for the entire tenant',
              )}
            </p>
          </div>
          <div className="flex items-center gap-[8px]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto gap-[6px] rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              onClick={() => {
                setCreateCategoryOpen((current) => !current)
                setNewCategoryName('')
                setNewCategorySelectionMode('multi')
              }}
            >
              <Plus className="size-[13px]" />
              {t('customers.tags.manage.addCategory', 'New category')}
            </Button>
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              className="size-[28px] shrink-0 rounded-[6px] border-border"
              onClick={onClose}
              aria-label={t('customers.tags.manage.closeDialog', 'Close')}
            >
              <X className="size-[13px]" />
            </IconButton>
          </div>
        </div>
        <div className="h-px shrink-0 bg-border" />

        {loading ? (
          <div className="px-[28px] py-12 text-center text-sm text-muted-foreground">
            {t('customers.tags.manage.loading', 'Loading...')}
          </div>
        ) : (
          <>
            {createCategoryOpen ? (
              <div className="flex shrink-0 flex-wrap items-center gap-[10px] border-b border-border px-[24px] py-[12px]">
                <div className="min-w-[220px] flex-1 rounded-[8px] border border-input bg-background px-[12px] py-[8px]">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void handleCreateCategory()
                      }
                    }}
                    placeholder={t('customers.tags.manage.addCategoryPlaceholder', 'Category name...')}
                    className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="flex items-center gap-[4px] rounded-[8px] border border-border bg-muted/60 p-[4px]">
                  <Button
                    type="button"
                    variant={newCategorySelectionMode === 'single' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-auto rounded-[6px] px-[10px] py-[6px] text-[12px]"
                    onClick={() => setNewCategorySelectionMode('single')}
                  >
                    {t('customers.tags.manage.categoryMode.single', 'Single')}
                  </Button>
                  <Button
                    type="button"
                    variant={newCategorySelectionMode === 'multi' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-auto rounded-[6px] px-[10px] py-[6px] text-[12px]"
                    onClick={() => setNewCategorySelectionMode('multi')}
                  >
                    {t('customers.tags.manage.categoryMode.multi', 'Multi')}
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-auto rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
                  onClick={() => {
                    void handleCreateCategory()
                  }}
                  disabled={creatingCategory}
                >
                  {creatingCategory
                    ? t('customers.tags.manage.creatingCategory', 'Creating...')
                    : t('customers.tags.manage.createCategory', 'Create category')}
                </Button>
              </div>
            ) : null}

            {/* Tab bar */}
            <div className="flex shrink-0 items-center gap-[8px] border-b border-border px-[16px] py-[6px]">
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                className="size-[30px] shrink-0 rounded-full"
                onClick={() => scrollCategoryRail('left')}
                disabled={!canScrollLeft}
                aria-label={t('customers.tags.manage.scrollLeft', 'Scroll categories left')}
              >
                <ChevronsLeft className="size-[14px]" />
              </IconButton>
              <div
                ref={categoryRailRef}
                className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex items-end gap-[2px]">
                  {translatedCategories.map((category) => {
                    const Icon = category.icon
                    const isActive = category.kind === activeTab
                    const count = entryCounts[category.kind] ?? 0
                    return (
                      <Button
                        key={category.kind}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setActiveTab(category.kind)
                          setSearchValue('')
                        }}
                        className={`flex h-auto shrink-0 items-center gap-[5px] rounded-none border-b-2 px-[10px] py-[8px] hover:bg-transparent ${
                          isActive
                            ? '-mb-px border-foreground text-foreground'
                            : '-mb-px border-transparent text-muted-foreground'
                        }`}
                      >
                        <Icon className="size-[13px]" />
                        <span
                          className={`whitespace-nowrap text-[11px] ${isActive ? 'font-semibold' : 'font-medium'}`}
                        >
                          {category.shortLabel}
                        </span>
                        <span className="rounded-[3px] bg-muted px-[4px] py-px text-[9px] font-semibold text-foreground">
                          {count}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              </div>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                className="size-[30px] shrink-0 rounded-full"
                onClick={() => scrollCategoryRail('right')}
                disabled={!canScrollRight}
                aria-label={t('customers.tags.manage.scrollRight', 'Scroll categories right')}
              >
                <ChevronsRight className="size-[14px]" />
              </IconButton>
            </div>

            {/* Content */}
            <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[24px] py-[14px]">
              {activeMeta ? (
                <>
                  {/* Category header + search */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-[3px]">
                      <div className="flex items-center gap-[6px]">
                        <span className="text-[15px] font-bold text-foreground">
                          {activeMeta.shortLabel}
                        </span>
                        {(activeMeta.badges ?? []).map((badge) => (
                          <span
                            key={badge}
                            className={`rounded-[3px] px-[7px] py-[2px] text-[9px] font-bold ${
                              badge === 'required'
                                ? 'bg-amber-100 text-amber-500'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {badge === 'required'
                              ? t('customers.tags.manage.badge.required', 'REQUIRED')
                              : t('customers.tags.manage.badge.system', 'SYSTEM')}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-[6px]">
                        <Info className="size-[12px] shrink-0 text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground">
                          {activeMeta.description}
                        </span>
                      </div>
                    </div>
                    <div className="relative w-[220px] shrink-0">
                      <Search className="absolute left-[12px] top-1/2 size-[13px] -translate-y-1/2 text-muted-foreground/70" />
                      <input
                        type="text"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        placeholder={t('customers.tags.manage.search', 'Search values...')}
                        className="w-full rounded-[6px] border border-input bg-background py-[8px] pl-[36px] pr-[12px] text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground"
                      />
                    </div>
                  </div>

                  {/* Column headers */}
                  <div className="flex items-center gap-[12px] px-[12px] py-[6px]">
                    <div className="w-[18px] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="text-[9px] font-bold uppercase text-muted-foreground">
                        {t('customers.tags.manage.columns.label', 'LABEL')}
                      </span>
                    </div>
                    <div className="w-[140px] shrink-0">
                      <span className="text-[9px] font-bold uppercase text-muted-foreground">
                        {t('customers.tags.manage.columns.slug', 'SLUG')}
                      </span>
                    </div>
                    <div className="w-[80px] shrink-0">
                      <span className="text-[9px] font-bold uppercase text-muted-foreground">
                        {t('customers.tags.manage.columns.color', 'COLOR')}
                      </span>
                    </div>
                    <div className="w-[32px] shrink-0" />
                  </div>

                  {/* Entry rows */}
                  <div className="flex flex-col gap-[8px]">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={visibleEntries.map((e) => e.localId)}
                        strategy={verticalListSortingStrategy}
                      >
                        {visibleEntries.map((entry, index) => (
                          <SortableEntryRow
                            key={entry.localId}
                            entry={entry}
                            isDefault={index === 0 && entry.id !== null}
                            onLabelChange={(value) => {
                              updateDraftEntry(activeTab, entry.localId, (current) => ({
                                ...current,
                                label: value,
                                value: current.manualValue
                                  ? current.value
                                  : slugifyLabel(value),
                              }))
                            }}
                            onValueChange={(value) => {
                              updateDraftEntry(activeTab, entry.localId, (current) => ({
                                ...current,
                                value,
                                manualValue: true,
                              }))
                            }}
                            onColorChange={(value) => {
                              updateDraftEntry(activeTab, entry.localId, (current) => ({
                                ...current,
                                color: value,
                              }))
                            }}
                            onDelete={() => handleDeleteEntry(activeTab, entry.localId)}
                            t={t}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>

                    {visibleEntries.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        {t(
                          'customers.tags.manage.noMatches',
                          'No entries match the current search.',
                        )}
                      </div>
                    )}
                  </div>

                  {/* Add new value */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleAddEntry}
                    className="flex h-auto w-full items-center justify-center gap-[8px] rounded-[6px] border border-dashed border-border bg-background p-[12px] text-[12px] font-semibold text-foreground hover:bg-muted"
                  >
                    <Plus className="size-[14px]" />
                    {t('customers.tags.manage.addValue', 'Add new value')}
                  </Button>

                  {/* Info note */}
                  <div className="flex items-start gap-[10px] rounded-[6px] bg-muted px-[14px] py-[12px]">
                    <Info className="mt-0.5 size-[14px] shrink-0 text-muted-foreground" />
                    <div className="flex flex-1 flex-col gap-[3px]">
                      <span className="text-[11px] font-semibold text-foreground">
                        {activeMeta.noteTitle}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {activeMeta.noteDescription}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t('customers.tags.manage.noDictionaries', 'No tag categories found.')}
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="h-px shrink-0 bg-border" />

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between px-[24px] py-[12px]">
              <div className="flex items-center gap-[6px]">
                <Info className="size-[12px] shrink-0 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {t(
                    'customers.tags.manage.tenantNotice',
                    'Changes apply to the entire tenant \u00b7 visible immediately',
                  )}
                </span>
              </div>
              <div className="flex items-center gap-[10px]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="rounded-[6px] border-border px-[16px] py-[10px] text-[13px] font-semibold text-foreground"
                >
                  {t('customers.tags.manage.close', 'Cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleSave()
                  }}
                  disabled={saving || !hasChanges}
                  className="rounded-[6px] bg-foreground px-[16px] py-[10px] text-[13px] font-semibold text-background hover:bg-foreground/90"
                >
                  <Save className="mr-[8px] size-[15px]" />
                  {saving
                    ? t('customers.tags.manage.saving', 'Saving...')
                    : t('customers.tags.manage.save', 'Save changes')}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
