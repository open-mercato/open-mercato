'use client'

import * as React from 'react'
import { Check, Plus, Search, Tag, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
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

type DictEntry = { id: string; value: string; label: string; color?: string | null }

type KindSetting = {
  kind: string
  selectionMode: 'single' | 'multi'
  visibleInTags: boolean
  sortOrder: number
}

type LabelItem = { id: string; slug: string; label: string }

type CategorySection = {
  kind: string
  label: string
  entries: DictEntry[]
  selectionMode: 'single' | 'multi'
  hasColorDots: boolean
  /** Field name on person entity that stores the value for this kind, or null if not a scalar field */
  personField: string | null
}

// ---------------------------------------------------------------------------
// Kind → person field mapping
// ---------------------------------------------------------------------------

const KIND_TO_PERSON_FIELD: Record<string, string> = {
  status: 'status',
  lifecycle_stage: 'lifecycleStage',
  source: 'source',
  temperature: 'temperature',
  renewal_quarter: 'renewalQuarter',
}

const KIND_ROUTE_MAP: Record<string, string> = {
  statuses: 'status',
  sources: 'source',
  'lifecycle-stages': 'lifecycle_stage',
  'address-types': 'address_type',
  'activity-types': 'activity_type',
  'deal-statuses': 'deal_status',
  'pipeline-stages': 'pipeline_stage',
  'job-titles': 'job_title',
  industries: 'industry',
  temperature: 'temperature',
  'renewal-quarters': 'renewal_quarter',
  'person-company-roles': 'person_company_role',
}

const KIND_DISPLAY_LABELS: Record<string, string> = {
  statuses: 'Status',
  'lifecycle-stages': 'Lifecycle',
  sources: 'Source',
  temperature: 'Temperature',
  'renewal-quarters': 'Renewal quarter',
  'person-company-roles': 'Roles',
  'activity-types': 'Activity',
  'deal-statuses': 'Deal status',
  industries: 'Industry',
  'address-types': 'Address',
  'pipeline-stages': 'Pipeline',
  'job-titles': 'Job title',
}

/** All dictionary categories show color dots — not limited to a subset. */
const KINDS_WITH_COLOR_DOTS_ALWAYS = true

const DEFAULT_VISIBLE_KINDS = new Set(['statuses', 'lifecycle-stages', 'sources'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------
// Chip component
// ---------------------------------------------------------------------------

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
      {showColorDot && color && (
        <span
          className="inline-block size-[7px] shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="text-[12px]">{label}</span>
      {active && <X className="size-[10px] shrink-0" />}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

type PersonTagsDialogProps = {
  open: boolean
  onClose: () => void
  personId: string
  personOrganizationId: string | null
  personData: {
    status?: string | null
    lifecycleStage?: string | null
    source?: string | null
    temperature?: string | null
    renewalQuarter?: string | null
  }
  onSaved?: () => void
}

export function PersonTagsDialog({
  open,
  onClose,
  personId,
  personOrganizationId,
  personData,
  onSaved,
}: PersonTagsDialogProps) {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState('')

  // Loaded data
  const [categories, setCategories] = React.useState<CategorySection[]>([])
  const [labels, setLabels] = React.useState<LabelItem[]>([])

  // Draft selections
  const [selectedValues, setSelectedValues] = React.useState<Record<string, Set<string>>>({})
  const [selectedLabelIds, setSelectedLabelIds] = React.useState<Set<string>>(new Set())

  // Original state for change detection
  const [originalValues, setOriginalValues] = React.useState<Record<string, Set<string>>>({})
  const [originalLabelIds, setOriginalLabelIds] = React.useState<Set<string>>(new Set())

  // New label input
  const [newLabelInput, setNewLabelInput] = React.useState<string | null>(null)
  const [isCreatingLabel, setIsCreatingLabel] = React.useState(false)
  const labelCreationInFlightRef = React.useRef(false)

  // --- load data ---

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      // Load kind settings (use non-throwing apiCall to avoid session-expired redirect if table doesn't exist yet)
      let kindSettings: KindSetting[] = []
      const scopedQuery = new URLSearchParams()
      if (personOrganizationId) {
        scopedQuery.set('organizationId', personOrganizationId)
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
        // No settings yet — use defaults
      }

      const settingsMap = new Map(kindSettings.map((s) => [s.kind, s]))

      // Determine which kinds to load
      const allKinds = Object.keys(KIND_ROUTE_MAP)
      const visibleKinds = allKinds.filter((routeKind) => {
        const mappedKind = KIND_ROUTE_MAP[routeKind]
        const setting = settingsMap.get(mappedKind)
        if (setting) return setting.visibleInTags
        return DEFAULT_VISIBLE_KINDS.has(routeKind)
      })

      // Load entries for each visible kind
      const loadedCategories: CategorySection[] = []
      for (const routeKind of visibleKinds) {
        const mappedKind = KIND_ROUTE_MAP[routeKind]
        const setting = settingsMap.get(mappedKind)
        try {
          const dictionaryUrl = new URL(`/api/customers/dictionaries/${routeKind}`, 'http://localhost')
          if (personOrganizationId) {
            dictionaryUrl.searchParams.set('organizationId', personOrganizationId)
          }
          const dictCall = await apiCall<{ items?: DictEntry[] }>(
            `${dictionaryUrl.pathname}${dictionaryUrl.search}`,
            { cache: 'no-store', headers: { 'x-om-unauthorized-redirect': '0' } },
          )
          const data = dictCall.ok ? dictCall.result : null
          if (!data) continue
          loadedCategories.push({
            kind: routeKind,
            label: KIND_DISPLAY_LABELS[routeKind] ?? routeKind,
            entries: data?.items ?? [],
            selectionMode: (setting?.selectionMode as 'single' | 'multi') ?? 'single',
            hasColorDots: KINDS_WITH_COLOR_DOTS_ALWAYS,
            personField: KIND_TO_PERSON_FIELD[mappedKind] ?? null,
          })
        } catch {
          // Skip failed categories
        }
      }

      // Sort by setting sortOrder
      loadedCategories.sort((a, b) => {
        const aOrder = settingsMap.get(KIND_ROUTE_MAP[a.kind])?.sortOrder ?? 999
        const bOrder = settingsMap.get(KIND_ROUTE_MAP[b.kind])?.sortOrder ?? 999
        return aOrder - bOrder
      })

      setCategories(loadedCategories)

      // Build initial selections from person data
      const initialValues: Record<string, Set<string>> = {}
      for (const category of loadedCategories) {
        const set = new Set<string>()
        if (category.personField) {
          const currentValue = (personData as Record<string, unknown>)[category.personField]
          if (typeof currentValue === 'string' && currentValue.trim()) {
            set.add(currentValue.trim())
          }
        }
        initialValues[category.kind] = set
      }
      setSelectedValues(initialValues)
      setOriginalValues(
        Object.fromEntries(
          Object.entries(initialValues).map(([k, v]) => [k, new Set(v)]),
        ),
      )

      // Load user labels (use non-throwing apiCall — table may not exist yet)
      try {
        const labelsQuery = new URLSearchParams()
        labelsQuery.set('entityId', personId)
        if (personOrganizationId) {
          labelsQuery.set('organizationId', personOrganizationId)
        }
        const labelsCall = await apiCall<{
          items?: LabelItem[]
          assignedIds?: string[]
        }>(`/api/customers/labels?${labelsQuery.toString()}`, {
          cache: 'no-store',
          headers: { 'x-om-unauthorized-redirect': '0' },
        })
        const labelsData = labelsCall.ok ? labelsCall.result : null
        setLabels(labelsData?.items ?? [])
        const assignedSet = new Set(labelsData?.assignedIds ?? [])
        setSelectedLabelIds(assignedSet)
        setOriginalLabelIds(new Set(assignedSet))
      } catch {
        setLabels([])
        setSelectedLabelIds(new Set())
        setOriginalLabelIds(new Set())
      }
    } finally {
      setLoading(false)
    }
  }, [personData, personId, personOrganizationId])

  React.useEffect(() => {
    if (!open) return
    setSearchValue('')
    setNewLabelInput(null)
    loadData().catch(() => {})
  }, [loadData, open])

  // --- derived ---

  const activeCount = React.useMemo(() => {
    let count = 0
    for (const set of Object.values(selectedValues)) {
      count += set.size
    }
    count += selectedLabelIds.size
    return count
  }, [selectedValues, selectedLabelIds])

  const hasChanges = React.useMemo(() => {
    for (const kind of Object.keys(selectedValues)) {
      const current = selectedValues[kind]
      const original = originalValues[kind]
      if (!original) {
        if (current.size > 0) return true
        continue
      }
      if (current.size !== original.size) return true
      for (const v of current) {
        if (!original.has(v)) return true
      }
    }
    if (selectedLabelIds.size !== originalLabelIds.size) return true
    for (const id of selectedLabelIds) {
      if (!originalLabelIds.has(id)) return true
    }
    return false
  }, [selectedValues, originalValues, selectedLabelIds, originalLabelIds])

  // --- filter ---

  const query = searchValue.trim().toLowerCase()

  const filteredCategories = React.useMemo(
    () =>
      categories.map((cat) => ({
        ...cat,
        entries: query
          ? cat.entries.filter(
              (e) =>
                e.label.toLowerCase().includes(query) ||
                e.value.toLowerCase().includes(query),
            )
          : cat.entries,
      })),
    [categories, query],
  )

  const filteredLabels = React.useMemo(
    () =>
      query
        ? labels.filter(
            (l) =>
              l.label.toLowerCase().includes(query) ||
              l.slug.toLowerCase().includes(query),
          )
        : labels,
    [labels, query],
  )

  // --- selection handlers ---

  const toggleDictValue = React.useCallback(
    (kind: string, value: string, selectionMode: 'single' | 'multi') => {
      setSelectedValues((prev) => {
        const current = new Set(prev[kind] ?? [])
        if (current.has(value)) {
          current.delete(value)
        } else {
          if (selectionMode === 'single') {
            current.clear()
          }
          current.add(value)
        }
        return { ...prev, [kind]: current }
      })
    },
    [],
  )

  const toggleLabel = React.useCallback((labelId: string) => {
    setSelectedLabelIds((prev) => {
      const next = new Set(prev)
      if (next.has(labelId)) {
        next.delete(labelId)
      } else {
        next.add(labelId)
      }
      return next
    })
  }, [])

  // --- create label ---

  const handleCreateLabel = React.useCallback(
    async (labelText: string) => {
      const trimmed = labelText.trim()
      if (!trimmed || labelCreationInFlightRef.current) {
        if (!trimmed) {
          setNewLabelInput(null)
        }
        return
      }
      const normalizedSlug = slugifyLabel(trimmed)
      const existingLabel = labels.find((item) => item.slug === normalizedSlug)
      if (existingLabel) {
        setSelectedLabelIds((prev) => new Set([...prev, existingLabel.id]))
        setNewLabelInput(null)
        return
      }

      labelCreationInFlightRef.current = true
      setIsCreatingLabel(true)
      try {
        const payload = personOrganizationId
          ? { label: trimmed, organizationId: personOrganizationId }
          : { label: trimmed }
        const result = await readApiResultOrThrow<{ id: string; slug: string; label: string }>(
          '/api/customers/labels',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        if (result) {
          setLabels((prev) =>
            [...prev, result].sort((left, right) =>
              left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
            ),
          )
          setSelectedLabelIds((prev) => new Set([...prev, result.id]))
          setNewLabelInput(null)
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.personTags.createLabelError', 'Failed to create label')
        flash(message, 'error')
      } finally {
        labelCreationInFlightRef.current = false
        setIsCreatingLabel(false)
      }
    },
    [labels, personOrganizationId, t],
  )

  // --- save ---

  const handleSave = React.useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      // 1. Build person update payload for scalar dictionary fields
      const personUpdate: Record<string, string | null> = {}
      for (const category of categories) {
        if (!category.personField) continue
        const currentSet = selectedValues[category.kind]
        const originalSet = originalValues[category.kind]
        const currentValue = currentSet?.size ? [...currentSet][0] : null
        const originalValue = originalSet?.size ? [...originalSet][0] : null
        if (currentValue !== originalValue) {
          personUpdate[category.personField] = currentValue
        }
      }

      if (Object.keys(personUpdate).length > 0) {
        await apiCallOrThrow('/api/customers/people', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: personId, ...personUpdate }),
        })
      }

      // 2. Sync label assignments
      const addedLabels = [...selectedLabelIds].filter((id) => !originalLabelIds.has(id))
      const removedLabels = [...originalLabelIds].filter((id) => !selectedLabelIds.has(id))

      for (const labelId of addedLabels) {
        const payload = personOrganizationId
          ? { labelId, entityId: personId, organizationId: personOrganizationId }
          : { labelId, entityId: personId }
        await apiCallOrThrow('/api/customers/labels/assign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      for (const labelId of removedLabels) {
        const payload = personOrganizationId
          ? { labelId, entityId: personId, organizationId: personOrganizationId }
          : { labelId, entityId: personId }
        await apiCallOrThrow('/api/customers/labels/unassign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      flash(t('customers.personTags.saveSuccess', 'Tags updated.'), 'success')
      onSaved?.()
      onClose()
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.personTags.saveError', 'Failed to save tags')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [
    categories,
    onClose,
    onSaved,
    personOrganizationId,
    originalLabelIds,
    originalValues,
    personId,
    saving,
    selectedLabelIds,
    selectedValues,
    t,
  ])

  // --- keyboard ---

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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden border-border bg-background p-0 shadow-[0px_16px_40px_0px_rgba(0,0,0,0.14)] sm:max-w-[480px] sm:rounded-[16px] [&>[data-dialog-close]]:hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>{t('customers.personTags.title', 'Manage tags')}</DialogTitle>
        </VisuallyHidden>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-[20px] py-[16px]">
          <div className="flex items-center gap-[8px]">
            <Tag className="size-[16px] text-foreground" />
            <span className="text-[15px] font-bold text-foreground">
              {t('customers.personTags.title', 'Manage tags')}
            </span>
          </div>
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

        {/* Search */}
        <div className="shrink-0 px-[20px] py-[8px]">
          <div className="flex items-center gap-[8px] rounded-[6px] border border-input bg-background px-[12px] py-[9px]">
            <Search className="size-[14px] shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('customers.personTags.searchPlaceholder', 'Search by name, role, email...')}
              className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-[20px] py-[16px]">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('customers.personTags.loading', 'Loading...')}
            </div>
          ) : (
            <div className="flex flex-col gap-[16px]">
              {/* Dictionary categories */}
              {filteredCategories.map((category) => {
                if (category.entries.length === 0 && query) return null
                const selected = selectedValues[category.kind] ?? new Set()
                return (
                  <div key={category.kind} className="flex flex-col gap-[10px]">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`customers.personTags.category.${category.kind}`, category.label)}
                    </span>
                    <div className="flex flex-wrap gap-x-[6px] gap-y-[8px]">
                      {category.entries.map((entry) => (
                        <TagChip
                          key={entry.id}
                          label={entry.label}
                          color={entry.color}
                          active={selected.has(entry.value)}
                          showColorDot={category.hasColorDots}
                          onClick={() =>
                            toggleDictValue(category.kind, entry.value, category.selectionMode)
                          }
                        />
                      ))}
                    </div>
                  </div>
                )
              })}

              {/* ETYKIETY (Labels) */}
              <div className="flex flex-col gap-[10px]">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('customers.personTags.labels', 'Labels')}
                </span>
                <div className="flex flex-wrap gap-x-[6px] gap-y-[8px]">
                  {filteredLabels.map((label) => (
                    <TagChip
                      key={label.id}
                      label={label.label}
                      active={selectedLabelIds.has(label.id)}
                      showColorDot={false}
                      onClick={() => toggleLabel(label.id)}
                    />
                  ))}

                  {/* New label input */}
                  {newLabelInput !== null ? (
                    <div className="inline-flex items-center rounded-full border border-dashed border-lime-400/70 bg-lime-500/5 px-[10px] py-[4px] dark:border-lime-300/40 dark:bg-lime-300/10">
                      <input
                        type="text"
                        autoFocus
                        value={newLabelInput}
                        disabled={isCreatingLabel}
                        onChange={(e) => setNewLabelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleCreateLabel(newLabelInput)
                          }
                          if (e.key === 'Escape') {
                            setNewLabelInput(null)
                          }
                        }}
                        onBlur={() => {
                          if (labelCreationInFlightRef.current) {
                            return
                          }
                          if (newLabelInput.trim()) {
                            void handleCreateLabel(newLabelInput)
                          } else {
                            setNewLabelInput(null)
                          }
                        }}
                        placeholder={t('customers.personTags.newLabelPlaceholder', 'Label name...')}
                        className="w-[100px] bg-transparent text-[12px] font-semibold text-lime-700 outline-none placeholder:text-lime-700/60 disabled:cursor-wait disabled:opacity-70 dark:text-lime-300 dark:placeholder:text-lime-300/60"
                      />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isCreatingLabel}
                      onClick={() => setNewLabelInput('')}
                      className="inline-flex h-auto items-center gap-[4px] rounded-full border border-dashed border-lime-400/70 bg-transparent px-[10px] py-[6px] font-semibold text-lime-700 hover:bg-lime-500/10 disabled:opacity-60 dark:border-lime-300/40 dark:text-lime-300 dark:hover:bg-lime-300/10"
                    >
                      <Plus className="size-[10px]" />
                      <span className="text-[12px]">
                        {t('customers.personTags.newLabel', 'New label')}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/20 px-[20px] py-[14px]">
          <span className="text-[12px] text-muted-foreground">
            {t('customers.personTags.activeCount', '{{count}} active', { count: activeCount })}
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
    </Dialog>
  )
}
