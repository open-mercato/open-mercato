'use client'
import * as React from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '../../primitives/popover'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Alert, AlertDescription } from '../../primitives/alert'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../primitives/dialog'
import { Filter, Save, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  deserializeTreeFromPersist,
  isPersistedFilterTree,
  serializeTreeForPersist,
  type AdvancedFilterTree,
  type PersistedFilterTree,
} from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'
import { getDefaultOperator } from '@open-mercato/shared/lib/query/advanced-filter'
import type { ValidationError } from './filterValidation'
import { AdvancedFilterBuilder } from './AdvancedFilterBuilder'
import { FilterEmptyState } from './FilterEmptyState'
import { QuickFilters, type FilterPreset } from './QuickFilters'
import { FilterFieldPicker } from './FilterFieldPicker'
import { treeReducer } from './treeReducer'
import { flash } from '../FlashMessages'

export type AdvancedFilterPanelProps = {
  fields: FilterFieldDef[]
  value: AdvancedFilterTree
  onChange: (t: AdvancedFilterTree) => void
  onApply: () => void
  onClear: () => void
  onFlush?: () => void
  pendingErrors: ValidationError[]
  userId: string
  presets: FilterPreset[]
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef?: React.RefObject<HTMLElement | null>
  aiSlot?: React.ReactNode
  savedFilterStorageKey?: string
}

type SavedAdvancedFilter = {
  id: string
  name: string
  tree: PersistedFilterTree
  createdAt: string
  updatedAt: string
}

/**
 * Versioned envelope for saved-filter records in localStorage. The `v` discriminator
 * lets future schema changes (rename fields, retention policy, sharing flags) migrate
 * existing records instead of silently dropping them. Bump `v` when adding a breaking
 * change and add a read-old migration branch in `readSavedFilters`.
 */
type SavedFiltersEnvelopeV1 = {
  v: 1
  filters: SavedAdvancedFilter[]
}

const SAVED_FILTER_STORAGE_PREFIX = 'open-mercato:advanced-filters:'
const MAX_SAVED_FILTERS = 20
const CURRENT_SAVED_FILTERS_VERSION = 1 as const

function makeSavedFilterStorageKey(key?: string): string | null {
  const trimmed = key?.trim()
  return trimmed ? `${SAVED_FILTER_STORAGE_PREFIX}${trimmed}` : null
}

function isSavedAdvancedFilter(value: unknown): value is SavedAdvancedFilter {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
    && isPersistedFilterTree(record.tree)
  )
}

function readSavedFilters(storageKey: string): SavedAdvancedFilter[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // v1 envelope (current shape).
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const envelope = parsed as { v?: unknown; filters?: unknown }
      if (envelope.v === 1 && Array.isArray(envelope.filters)) {
        return envelope.filters.filter(isSavedAdvancedFilter)
      }
    }
    // Pre-envelope shape (bare array) — migrate forward on next write.
    if (Array.isArray(parsed)) {
      return parsed.filter(isSavedAdvancedFilter)
    }
    return []
  } catch {
    return []
  }
}

function writeSavedFilters(storageKey: string, filters: SavedAdvancedFilter[]) {
  if (typeof window === 'undefined') return
  const envelope: SavedFiltersEnvelopeV1 = { v: CURRENT_SAVED_FILTERS_VERSION, filters }
  window.localStorage.setItem(storageKey, JSON.stringify(envelope))
}

function SaveFilterDialog({
  open,
  onOpenChange,
  onSave,
  t,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (name: string) => Promise<void>
  t: (key: string, fallback: string) => string
}) {
  const [name, setName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const trimmed = name.trim()

  React.useEffect(() => {
    if (!open) {
      setName('')
      setSaving(false)
      setError(null)
    }
  }, [open])

  const submit = React.useCallback(async () => {
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('ui.advancedFilter.saveFilter.error', 'Failed to save filter'))
    } finally {
      setSaving(false)
    }
  }, [onSave, onOpenChange, saving, t, trimmed])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `elevated` lifts this dialog above the popover (z-popover=45) — at default
          z-modal=40 the dialog is occluded by the popover that opens it. */}
      <DialogContent elevated className="sm:max-w-md" data-advanced-filter-portal>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('ui.advancedFilter.saveFilter.title', 'Save filter')}</DialogTitle>
            <DialogDescription>
              {t('ui.advancedFilter.saveFilter.description', 'Name this filter so you can reuse the current conditions later.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('ui.advancedFilter.saveFilter.placeholder', 'Filter name')}
              aria-label={t('ui.advancedFilter.saveFilter.nameAriaLabel', 'Filter name')}
              autoFocus
            />
            {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!trimmed || saving}>
              {saving ? t('ui.advancedFilter.saveFilter.saving', 'Saving...') : t('ui.advancedFilter.saveFilter.submit', 'Save filter')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SavedFiltersSection({
  filters,
  canSaveCurrent,
  onSaveClick,
  onApply,
  onDelete,
  t,
}: {
  filters: SavedAdvancedFilter[]
  canSaveCurrent: boolean
  onSaveClick: () => void
  onApply: (filter: SavedAdvancedFilter) => void
  onDelete: (filterId: string) => void
  t: (key: string, fallback: string) => string
}) {
  if (!canSaveCurrent && filters.length === 0) return null
  return (
    <div className="flex flex-col gap-2" data-testid="advanced-filter-saved-filters">
      <div className="flex items-center justify-between gap-3">
        <div className="text-overline font-medium uppercase tracking-widest text-muted-foreground">
          {t('ui.advancedFilter.savedFilters.heading', 'Saved filters')}
        </div>
        {canSaveCurrent ? (
          <Button
            data-testid="advanced-filter-save-trigger"
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full gap-1.5"
            onClick={onSaveClick}
          >
            <Save className="size-3.5 text-muted-foreground" />
            {t('ui.advancedFilter.saveFilter.button', 'Save filter')}
          </Button>
        ) : null}
      </div>
      {filters.length ? (
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <div key={filter.id} className="inline-flex max-w-full items-center overflow-hidden rounded-full border border-border bg-background">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 min-w-0 rounded-r-none px-3 gap-1.5"
                title={filter.name}
                onClick={() => onApply(filter)}
              >
                <Filter className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{filter.name}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-l-none px-0 text-muted-foreground hover:text-status-error-text"
                aria-label={`${t('ui.advancedFilter.savedFilters.delete', 'Delete saved filter')}: ${filter.name}`}
                onClick={() => onDelete(filter.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('ui.advancedFilter.savedFilters.empty', 'No saved filters yet')}
        </p>
      )}
    </div>
  )
}

export function AdvancedFilterPanel(props: AdvancedFilterPanelProps) {
  const t = useT()
  const empty = props.value.root.children.length === 0
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false)
  const [savedFilters, setSavedFilters] = React.useState<SavedAdvancedFilter[]>([])
  const addConditionRef = React.useRef<HTMLButtonElement>(null)
  const savedFilterStorageKey = React.useMemo(
    () => makeSavedFilterStorageKey(props.savedFilterStorageKey),
    [props.savedFilterStorageKey],
  )

  // Flush on close — the hook's useEffect on close also flushes; this is belt-and-suspenders.
  const wasOpenRef = React.useRef(props.open)
  React.useEffect(() => {
    if (wasOpenRef.current && !props.open && props.onFlush) props.onFlush()
    wasOpenRef.current = props.open
  }, [props.open, props.onFlush])

  const handlePresetApply = (tree: AdvancedFilterTree) => {
    props.onChange(tree)
    props.onOpenChange(false)
  }

  React.useEffect(() => {
    if (!savedFilterStorageKey) {
      setSavedFilters([])
      return
    }
    if (props.open) {
      setSavedFilters(readSavedFilters(savedFilterStorageKey))
    }
  }, [props.open, savedFilterStorageKey])

  const persistSavedFilters = React.useCallback((next: SavedAdvancedFilter[]) => {
    if (!savedFilterStorageKey) return
    setSavedFilters(next)
    writeSavedFilters(savedFilterStorageKey, next)
  }, [savedFilterStorageKey])

  const handleSaveFilter = React.useCallback(async (name: string) => {
    if (!savedFilterStorageKey) return
    const now = new Date().toISOString()
    const normalizedName = name.trim()
    const existing = savedFilters.find((item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase())
    const record: SavedAdvancedFilter = {
      id: existing?.id ?? crypto.randomUUID(),
      name: normalizedName,
      tree: serializeTreeForPersist(props.value),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const next = [
      record,
      ...savedFilters.filter((item) => item.id !== record.id),
    ].slice(0, MAX_SAVED_FILTERS)
    persistSavedFilters(next)
    flash(t('ui.advancedFilter.saveFilter.success', 'Filter saved'), 'success')
  }, [persistSavedFilters, props.value, savedFilterStorageKey, savedFilters, t])

  const handleApplySavedFilter = React.useCallback((filter: SavedAdvancedFilter) => {
    const tree = deserializeTreeFromPersist(filter.tree)
    if (!tree) return
    props.onChange(tree)
    props.onOpenChange(false)
  }, [props.onChange, props.onOpenChange])

  const handleDeleteSavedFilter = React.useCallback((filterId: string) => {
    persistSavedFilters(savedFilters.filter((item) => item.id !== filterId))
  }, [persistSavedFilters, savedFilters])

  const shouldShowSavedFilters = Boolean(savedFilterStorageKey && (!empty || savedFilters.length > 0))
  const savedFiltersSection = shouldShowSavedFilters ? (
    <SavedFiltersSection
      filters={savedFilters}
      canSaveCurrent={!empty}
      onSaveClick={() => setSaveDialogOpen(true)}
      onApply={handleApplySavedFilter}
      onDelete={handleDeleteSavedFilter}
      t={t}
    />
  ) : null

  const emptyStateShortcuts = props.presets.length || savedFiltersSection ? (
    <div className="flex flex-col gap-4">
      {props.presets.length ? <QuickFilters presets={props.presets} userId={props.userId} onApply={handlePresetApply} /> : null}
      {savedFiltersSection}
    </div>
  ) : null

  const builderErrors = React.useMemo(
    () => props.pendingErrors.map(e => ({ ruleId: e.ruleId, messageKey: e.messageKey, message: e.message })),
    [props.pendingErrors],
  )
  const ignoreAdvancedFilterPortalInteractions = React.useCallback((event: { target: EventTarget | null; preventDefault: () => void }) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-advanced-filter-portal]')) {
      event.preventDefault()
    }
  }, [])

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      {props.triggerRef ? (
        <PopoverAnchor virtualRef={props.triggerRef as React.RefObject<{ getBoundingClientRect(): DOMRect }>} />
      ) : null}
      <PopoverContent
        className="w-[min(calc(100vw-2rem),780px)] max-h-[min(calc(100vh-6rem),720px)] overflow-y-auto p-0 gap-0"
        align="end"
        sideOffset={8}
        data-testid="advanced-filter-panel"
        onPointerDownOutside={ignoreAdvancedFilterPortalInteractions}
        onFocusOutside={ignoreAdvancedFilterPortalInteractions}
        onInteractOutside={ignoreAdvancedFilterPortalInteractions}
      >
        <VisuallyHidden>
          <h2>{t('ui.advancedFilter.dialog.title', 'Advanced filter')}</h2>
        </VisuallyHidden>
        <div className="flex flex-col">
          {empty ? (
            <FilterEmptyState
              onAddCondition={() => setPickerOpen(true)}
              addConditionRef={addConditionRef}
              aiSlot={props.aiSlot}
              quickFilters={emptyStateShortcuts}
            />
          ) : (
            <>
              <AdvancedFilterBuilder
                fields={props.fields}
                value={props.value}
                onChange={props.onChange}
                onApply={props.onApply}
                onClear={props.onClear}
                pendingErrors={builderErrors}
              />
              {savedFiltersSection ? (
                <div className="border-t border-border p-3">
                  {savedFiltersSection}
                </div>
              ) : null}
            </>
          )}
          {props.pendingErrors.length > 0 ? (
            <div className="p-3 border-t border-border" data-testid="filter-validation-banner">
              <Alert variant="destructive">
                <AlertDescription>
                  {props.pendingErrors.length === 1
                    ? t('ui.advancedFilter.banner.incomplete', '{count} filter is incomplete — filters won\'t apply until all values are picked.', { count: 1 })
                    : t('ui.advancedFilter.banner.incompletePlural', '{count} filters are incomplete — filters won\'t apply until all values are picked.', { count: props.pendingErrors.length })}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
        </div>
      </PopoverContent>
      <FilterFieldPicker
        fields={props.fields}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(field) => {
          // Pass defaultOperator so the rule starts with a valid operator for the field's
          // type — otherwise emptyRule defaults to 'contains', which only matches text.
          const next = treeReducer(props.value, {
            type: 'addRule',
            groupId: props.value.root.id,
            defaultField: field.key,
            defaultOperator: getDefaultOperator(field.type),
          })
          props.onChange(next)
        }}
        triggerRef={addConditionRef}
      />
      <SaveFilterDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={handleSaveFilter}
        t={t}
      />
    </Popover>
  )
}
