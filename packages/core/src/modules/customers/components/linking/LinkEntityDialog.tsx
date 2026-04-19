'use client'

import * as React from 'react'
import {
  Check,
  Link2,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'

export type LinkEntityKind = 'company' | 'person' | 'deal'

export type LinkEntityOption = {
  id: string
  label: string
  subtitle?: string | null
  avatarSeed?: string | null
  icon?: React.ReactNode
  meta?: Record<string, unknown>
}

export type LinkEntitySearchPage = {
  items: LinkEntityOption[]
  totalPages: number
  total?: number
}

export type LinkEntityFilterOption = {
  id: string
  label: string
  count?: number
  dotColor?: string
}

export type LinkEntityRowContext = {
  selected: boolean
  focused: boolean
  disabled?: boolean
}

export type LinkEntityAdapter<TDetails = unknown, TLinkSettings = Record<string, unknown>> = {
  kind: LinkEntityKind
  searchPage: (
    query: string,
    page: number,
    filterId?: string,
  ) => Promise<LinkEntitySearchPage>
  fetchByIds: (ids: string[]) => Promise<LinkEntityOption[]>
  fetchDetails?: (id: string) => Promise<TDetails>

  dialogTitle: string
  dialogSubtitle?: string
  headerIcon?: React.ReactNode
  sectionLabel?: string
  searchPlaceholder: string
  searchEmptyHint: string
  selectedEmptyHint: string
  confirmButtonLabel: string
  defaultAvatarIcon?: React.ReactNode

  filters?: {
    options: LinkEntityFilterOption[]
    defaultId?: string
    /**
     * Optional client-side predicate applied AFTER the server response.
     * Return true to keep the option when the given filter id is active.
     * When not provided, all items pass regardless of filter (filter effectively
     * only applies server-side via searchPage's third argument).
     */
    clientFilter?: (option: LinkEntityOption, filterId: string) => boolean
  }

  renderRow?: (
    option: LinkEntityOption,
    ctx: LinkEntityRowContext,
  ) => React.ReactNode
  renderPreview?: (option: LinkEntityOption, details?: TDetails) => React.ReactNode
  renderLinkSettings?: (
    settings: TLinkSettings,
    onChange: (next: TLinkSettings) => void,
    focusedOption: LinkEntityOption | null,
  ) => React.ReactNode
  initialLinkSettings?: TLinkSettings

  computeOrphanWarning?: (option: LinkEntityOption) => Promise<string | null>

  addNew?: {
    title: string
    subtitle?: string
    render: (ctx: {
      onCreated: (created: LinkEntityOption) => void
      onCancel: () => void
    }) => React.ReactNode
  }
}

export type LinkEntityConfirmInput<TLinkSettings = Record<string, unknown>> = {
  addedIds: string[]
  removedIds: string[]
  nextSelectedIds: string[]
  primaryId?: string | null
  optionsById: Record<string, LinkEntityOption>
  linkSettings?: TLinkSettings
}

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type LinkEntityDialogProps<TDetails = unknown, TLinkSettings = Record<string, unknown>> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  adapter: LinkEntityAdapter<TDetails, TLinkSettings>
  initialSelectedIds: string[]
  initialPrimaryId?: string | null
  primarySupported?: boolean
  onConfirm: (next: LinkEntityConfirmInput<TLinkSettings>) => Promise<void>
  runGuardedMutation?: GuardedMutationRunner
  avatarVariant?: 'default' | 'monochrome'
}

const SEARCH_DEBOUNCE_MS = 200

function diffSelection(initial: string[], next: string[]): { addedIds: string[]; removedIds: string[] } {
  const initialSet = new Set(initial)
  const nextSet = new Set(next)
  const addedIds: string[] = []
  const removedIds: string[] = []
  next.forEach((id) => {
    if (!initialSet.has(id)) addedIds.push(id)
  })
  initial.forEach((id) => {
    if (!nextSet.has(id)) removedIds.push(id)
  })
  return { addedIds, removedIds }
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

function mergeOptionMaps(
  existing: Map<string, LinkEntityOption>,
  entries: LinkEntityOption[],
): Map<string, LinkEntityOption> {
  const next = new Map(existing)
  entries.forEach((entry) => next.set(entry.id, entry))
  return next
}

type SelectionIndicatorProps = {
  checked: boolean
  disabled?: boolean
  label: string
}

function SelectionIndicator({ checked, disabled, label }: SelectionIndicatorProps) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={cn(
        'inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border transition-colors',
        checked
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background',
        disabled && 'opacity-50',
      )}
    >
      {checked ? <Check className="size-[12px]" strokeWidth={2.5} /> : null}
    </span>
  )
}

type DefaultRowProps = {
  option: LinkEntityOption
  ctx: LinkEntityRowContext
  avatarVariant: 'default' | 'monochrome'
  defaultAvatarIcon?: React.ReactNode
  selectLabel: string
}

function DefaultRow({
  option,
  ctx,
  avatarVariant,
  defaultAvatarIcon,
  selectLabel,
}: DefaultRowProps) {
  return (
    <>
      <Avatar
        label={option.label}
        variant={avatarVariant}
        size="md"
        icon={option.icon ?? defaultAvatarIcon}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{option.label}</div>
        {option.subtitle ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{option.subtitle}</div>
        ) : null}
      </div>
      <SelectionIndicator checked={ctx.selected} label={selectLabel} />
    </>
  )
}

export function LinkEntityDialog<TDetails = unknown, TLinkSettings = Record<string, unknown>>({
  open,
  onOpenChange,
  adapter,
  initialSelectedIds,
  initialPrimaryId,
  primarySupported = false,
  onConfirm,
  avatarVariant = 'monochrome',
}: LinkEntityDialogProps<TDetails, TLinkSettings>) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [activeFilter, setActiveFilter] = React.useState<string | undefined>(
    adapter.filters?.defaultId,
  )
  const [searchPage, setSearchPage] = React.useState(1)
  const [searchTotalPages, setSearchTotalPages] = React.useState(1)
  const [searchTotal, setSearchTotal] = React.useState<number | null>(null)
  const [searchResults, setSearchResults] = React.useState<LinkEntityOption[]>([])
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [draftIds, setDraftIds] = React.useState<string[]>(initialSelectedIds)
  const [draftPrimaryId, setDraftPrimaryId] = React.useState<string | null>(
    initialPrimaryId ?? null,
  )
  const [focusedId, setFocusedId] = React.useState<string | null>(null)
  const [optionCache, setOptionCache] = React.useState<Map<string, LinkEntityOption>>(
    () => new Map(),
  )
  const [details, setDetails] = React.useState<Record<string, TDetails>>({})
  const [detailsLoadingId, setDetailsLoadingId] = React.useState<string | null>(null)
  const [linkSettings, setLinkSettings] = React.useState<TLinkSettings>(
    adapter.initialLinkSettings ?? ({} as TLinkSettings),
  )
  const [saving, setSaving] = React.useState(false)
  const [nestedOpen, setNestedOpen] = React.useState(false)
  const requestIdRef = React.useRef(0)

  const initialIdsKey = React.useMemo(() => initialSelectedIds.join('|'), [initialSelectedIds])

  React.useEffect(() => {
    if (!open) return
    setDraftIds(initialSelectedIds)
    setDraftPrimaryId(initialPrimaryId ?? null)
    setQuery('')
    setActiveFilter(adapter.filters?.defaultId)
    setSearchPage(1)
    setSearchTotalPages(1)
    setSearchTotal(null)
    setSearchResults([])
    setFocusedId(null)
    setDetails({})
    setDetailsLoadingId(null)
    setLinkSettings(adapter.initialLinkSettings ?? ({} as TLinkSettings))
    setNestedOpen(false)
  }, [open, initialIdsKey, initialPrimaryId, adapter])

  React.useEffect(() => {
    if (!open) return
    setSearchPage(1)
  }, [open, query, activeFilter])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const current = ++requestIdRef.current
    setSearchLoading(true)
    const timeout = window.setTimeout(async () => {
      try {
        const result = await adapter.searchPage(query, searchPage, activeFilter)
        if (cancelled || current !== requestIdRef.current) return
        setSearchResults(result.items)
        setSearchTotalPages(Math.max(1, result.totalPages))
        setSearchTotal(typeof result.total === 'number' ? result.total : null)
        setOptionCache((prev) => mergeOptionMaps(prev, result.items))
      } catch {
        if (cancelled || current !== requestIdRef.current) return
        setSearchResults([])
        setSearchTotalPages(1)
        setSearchTotal(0)
      } finally {
        if (!cancelled && current === requestIdRef.current) {
          setSearchLoading(false)
        }
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [adapter, activeFilter, open, query, searchPage])

  React.useEffect(() => {
    if (!open) return
    const missingIds = draftIds.filter((id) => !optionCache.has(id))
    if (!missingIds.length) return
    let cancelled = false
    void adapter
      .fetchByIds(missingIds)
      .then((entries) => {
        if (cancelled) return
        setOptionCache((prev) => mergeOptionMaps(prev, entries))
      })
      .catch((error) => console.warn('[LinkEntityDialog] fetchByIds failed', error))
    return () => {
      cancelled = true
    }
  }, [adapter, draftIds, open, optionCache])

  const focusedOption: LinkEntityOption | null = React.useMemo(
    () => (focusedId ? optionCache.get(focusedId) ?? null : null),
    [focusedId, optionCache],
  )

  const fetchDetails = adapter.fetchDetails
  React.useEffect(() => {
    if (!open || !focusedId || !fetchDetails) return
    if (details[focusedId] !== undefined) return
    let cancelled = false
    setDetailsLoadingId(focusedId)
    void fetchDetails(focusedId)
      .then((result) => {
        if (cancelled) return
        setDetails((prev) => ({ ...prev, [focusedId]: result }))
      })
      .catch((error) => console.warn('[LinkEntityDialog] fetchDetails failed', error))
      .finally(() => {
        if (!cancelled) setDetailsLoadingId(null)
      })
    return () => {
      cancelled = true
    }
  }, [details, fetchDetails, focusedId, open])

  const draftSet = React.useMemo(() => new Set(draftIds), [draftIds])

  const displayedResults = React.useMemo(() => {
    const predicate = adapter.filters?.clientFilter
    const effectiveFilter = activeFilter ?? adapter.filters?.defaultId
    if (!predicate || !effectiveFilter) return searchResults
    return searchResults.filter((option) => predicate(option, effectiveFilter))
  }, [adapter.filters, activeFilter, searchResults])

  const toggleDraftId = React.useCallback((id: string, checked: boolean) => {
    setDraftIds((current) => {
      if (checked) {
        if (current.includes(id)) return current
        return [...current, id]
      }
      return current.filter((candidate) => candidate !== id)
    })
  }, [])

  const handleRowClick = React.useCallback(
    (option: LinkEntityOption) => {
      setFocusedId(option.id)
      const isSelected = draftSet.has(option.id)
      toggleDraftId(option.id, !isSelected)
    },
    [draftSet, toggleDraftId],
  )

  const handleAddNewCreated = React.useCallback(
    (option: LinkEntityOption) => {
      setOptionCache((prev) => mergeOptionMaps(prev, [option]))
      setDraftIds((current) => (current.includes(option.id) ? current : [...current, option.id]))
      setFocusedId(option.id)
      setNestedOpen(false)
    },
    [],
  )

  const handleDialogOpenChange = React.useCallback(
    (next: boolean) => {
      if (nestedOpen && !next) return
      onOpenChange(next)
    },
    [nestedOpen, onOpenChange],
  )

  const hasChanges = React.useMemo(() => {
    if (!sameIds(initialSelectedIds, draftIds)) return true
    if (primarySupported && (draftPrimaryId ?? null) !== (initialPrimaryId ?? null)) return true
    return false
  }, [draftIds, draftPrimaryId, initialPrimaryId, initialSelectedIds, primarySupported])

  const handleSave = React.useCallback(async () => {
    if (saving) return
    const { addedIds, removedIds } = diffSelection(initialSelectedIds, draftIds)
    const primaryChanged = primarySupported
      ? (draftPrimaryId ?? null) !== (initialPrimaryId ?? null)
      : false
    if (!addedIds.length && !removedIds.length && !primaryChanged) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    try {
      const optionsById: Record<string, LinkEntityOption> = {}
      optionCache.forEach((value, key) => {
        optionsById[key] = value
      })
      await onConfirm({
        addedIds,
        removedIds,
        nextSelectedIds: draftIds,
        primaryId: primarySupported ? draftPrimaryId : undefined,
        optionsById,
        linkSettings,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [
    draftIds,
    draftPrimaryId,
    initialPrimaryId,
    initialSelectedIds,
    linkSettings,
    onConfirm,
    onOpenChange,
    optionCache,
    primarySupported,
    saving,
  ])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (nestedOpen) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSave()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        handleDialogOpenChange(false)
      }
    },
    [handleDialogOpenChange, handleSave, nestedOpen],
  )

  const selectedCountLabel = React.useMemo(() => {
    const kindLabels: Record<LinkEntityKind, [string, string, string, string]> = {
      person: [
        'customers.linking.footer.personSingular',
        '{{count}} person selected',
        'customers.linking.footer.personPlural',
        '{{count}} people selected',
      ],
      company: [
        'customers.linking.footer.companySingular',
        '{{count}} company selected',
        'customers.linking.footer.companyPlural',
        '{{count}} companies selected',
      ],
      deal: [
        'customers.linking.footer.dealSingular',
        '{{count}} deal selected',
        'customers.linking.footer.dealPlural',
        '{{count}} deals selected',
      ],
    }
    const [singularKey, singularDefault, pluralKey, pluralDefault] = kindLabels[adapter.kind]
    if (draftIds.length === 1) {
      return t(singularKey, singularDefault, { count: String(draftIds.length) })
    }
    return t(pluralKey, pluralDefault, { count: String(draftIds.length) })
  }, [adapter.kind, draftIds.length, t])

  const filterOptions = adapter.filters?.options ?? []

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="flex flex-col gap-0 overflow-hidden p-0"
          style={{
            width: 'min(calc(100vw - 2rem), 920px)',
            maxWidth: 'min(calc(100vw - 2rem), 920px)',
            maxHeight: 'min(640px, calc(100vh - 4rem))',
          }}
          onKeyDown={handleKeyDown}
          aria-hidden={nestedOpen ? 'true' : undefined}
        >
          <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-border/70 bg-card px-6 py-5">
            {adapter.headerIcon ? (
              <div className="flex size-[22px] shrink-0 items-center justify-center text-foreground">
                {adapter.headerIcon}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[18px] font-bold text-foreground">
                {adapter.dialogTitle}
              </DialogTitle>
              {adapter.dialogSubtitle ? (
                <DialogDescription className="mt-0.5 text-[13px] text-muted-foreground">
                  {adapter.dialogSubtitle}
                </DialogDescription>
              ) : null}
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="flex min-h-0 flex-col gap-3 border-b border-border/70 bg-card p-4 lg:w-[480px] lg:shrink-0 lg:border-b-0 lg:border-r">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-[14px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={adapter.searchPlaceholder}
                  className="h-10 rounded-[6px] pl-9 pr-20 text-[13px]"
                  autoFocus
                  aria-label={adapter.searchPlaceholder}
                />
                {searchTotal !== null && !searchLoading ? (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                    {t('customers.linking.resultsCount', '{{count}} results', {
                      count: String(searchTotal),
                    })}
                  </span>
                ) : null}
              </div>

              {filterOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {filterOptions.map((filter) => {
                    const isActive = (activeFilter ?? adapter.filters?.defaultId) === filter.id
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => setActiveFilter(filter.id)}
                        className={cn(
                          'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold transition-colors',
                          isActive
                            ? 'bg-foreground text-background'
                            : 'bg-muted/70 text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {filter.dotColor ? (
                          <span
                            aria-hidden="true"
                            className="inline-block size-1.5 rounded-full"
                            style={{ backgroundColor: filter.dotColor }}
                          />
                        ) : null}
                        <span>{filter.label}</span>
                        {typeof filter.count === 'number' ? (
                          <span
                            className={cn(
                              'inline-flex min-w-[14px] items-center justify-center rounded-full px-1 text-[10px]',
                              isActive
                                ? 'bg-background/20 text-background'
                                : 'bg-background text-muted-foreground',
                            )}
                          >
                            {filter.count}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}

              {adapter.sectionLabel ? (
                <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                  {adapter.sectionLabel}
                </div>
              ) : null}

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
                {searchLoading && displayedResults.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {t('customers.linking.searching', 'Searching…')}
                  </div>
                ) : displayedResults.length === 0 ? (
                  <div className="rounded-[10px] border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                    {adapter.searchEmptyHint}
                  </div>
                ) : (
                  displayedResults.map((result) => {
                    const checked = draftSet.has(result.id)
                    const focused = focusedId === result.id
                    const ctx: LinkEntityRowContext = { selected: checked, focused }
                    const selectLabel = t('customers.linking.selectEntity', 'Select {{name}}', {
                      name: result.label,
                    })
                    return (
                      <div
                        key={result.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={checked}
                        onClick={() => handleRowClick(result)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            handleRowClick(result)
                          }
                        }}
                        className={cn(
                          'group flex cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/40',
                          checked
                            ? 'border-border bg-muted/50'
                            : 'border-border/70 bg-card hover:bg-muted/30',
                        )}
                      >
                        {adapter.renderRow ? (
                          adapter.renderRow(result, ctx)
                        ) : (
                          <DefaultRow
                            option={result}
                            ctx={ctx}
                            avatarVariant={avatarVariant}
                            defaultAvatarIcon={adapter.defaultAvatarIcon}
                            selectLabel={selectLabel}
                          />
                        )}
                      </div>
                    )
                  })
                )}

                {adapter.addNew ? (
                  <button
                    type="button"
                    onClick={() => setNestedOpen(true)}
                    className="mt-2 flex items-center gap-3 rounded-[10px] border border-dashed border-border px-4 py-3.5 text-left transition-colors hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring/40"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Plus className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-foreground">
                        {adapter.addNew.title}
                      </span>
                      {adapter.addNew.subtitle ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {adapter.addNew.subtitle}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-foreground text-background">
                      <Plus className="size-3.5" />
                    </span>
                  </button>
                ) : null}

                {searchTotalPages > 1 ? (
                  <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
                    <span aria-live="polite">
                      {t('customers.linking.pagination.pageOf', 'Page {{page}} of {{total}}', {
                        page: String(Math.min(searchPage, searchTotalPages)),
                        total: String(searchTotalPages),
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-[8px] px-2.5 text-[11px]"
                        disabled={searchLoading || searchPage <= 1}
                        onClick={() => setSearchPage((current) => Math.max(1, current - 1))}
                      >
                        {t('customers.linking.pagination.previousShort', 'Previous')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-[8px] px-2.5 text-[11px]"
                        disabled={searchLoading || searchPage >= searchTotalPages}
                        onClick={() =>
                          setSearchPage((current) => Math.min(searchTotalPages, current + 1))
                        }
                      >
                        {t('customers.linking.pagination.nextShort', 'Next')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-muted/20 p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                {t('customers.linking.preview.label', 'Preview')}
              </div>

              {focusedOption ? (
                <>
                  {adapter.renderPreview ? (
                    adapter.renderPreview(focusedOption, details[focusedOption.id])
                  ) : (
                    <div className="rounded-[12px] border border-border/70 bg-card p-[18px]">
                      <div className="flex items-center gap-3">
                        <Avatar
                          label={focusedOption.label}
                          variant={avatarVariant}
                          size="lg"
                          icon={focusedOption.icon ?? adapter.defaultAvatarIcon}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-base font-bold text-foreground">
                            {focusedOption.label}
                          </div>
                          {focusedOption.subtitle ? (
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {focusedOption.subtitle}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                  {detailsLoadingId === focusedOption.id && adapter.fetchDetails ? (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('customers.linking.preview.loading', 'Loading details…')}
                    </div>
                  ) : null}

                  {adapter.renderLinkSettings ? (
                    <div className="rounded-[12px] border border-border/70 bg-card p-[18px]">
                      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">
                        {t('customers.linking.settings.label', 'Link settings')}
                      </div>
                      {adapter.renderLinkSettings(linkSettings, setLinkSettings, focusedOption)}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center rounded-[12px] border border-dashed border-border/70 bg-card/40 p-6 text-center text-sm text-muted-foreground">
                  <Link2 className="mb-2 size-5 opacity-60" />
                  {t(
                    'customers.linking.preview.empty',
                    'Select an entry on the left to see details here.',
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex flex-row items-center justify-between border-t border-border/70 bg-muted/30 px-6 py-4 sm:flex-row sm:justify-between">
            <div className="text-[12px] text-muted-foreground">{selectedCountLabel}</div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDialogOpenChange(false)}
                disabled={saving}
                className="h-9 rounded-[8px] px-4"
              >
                {t('customers.linking.actions.cancel', 'Cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void handleSave()
                }}
                disabled={saving || !hasChanges}
                className="h-9 rounded-[8px] bg-foreground px-5 text-background hover:bg-foreground/90"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('customers.linking.actions.saving', 'Saving…')}
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 size-4" />
                    {adapter.confirmButtonLabel}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {adapter.addNew && nestedOpen
        ? adapter.addNew.render({
            onCreated: handleAddNewCreated,
            onCancel: () => setNestedOpen(false),
          })
        : null}
    </>
  )
}
