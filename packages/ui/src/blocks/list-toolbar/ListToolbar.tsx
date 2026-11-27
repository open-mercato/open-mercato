"use client"

import * as React from 'react'
import { MoreHorizontal, Plus, SlidersHorizontal, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  segmentedControlItemVariants,
  segmentedControlTrackVariants,
} from '@open-mercato/ui/primitives/segmented-control'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type { BlockAction } from '../contracts/shared'
import {
  LIST_TOOLBAR_DEFAULT_DEBOUNCE_MS,
  LIST_TOOLBAR_DEFAULT_MAX_VISIBLE_CHIPS,
  LIST_TOOLBAR_DEFAULT_STICKY_OFFSET,
  type ListToolbarChip,
  type ListToolbarProps,
  type ListToolbarQuickFilter,
  type ListToolbarSearch,
  type ListToolbarView,
} from '../contracts/list-toolbar'

const MAX_VISIBLE_SECONDARY_ACTIONS = 2
const MAX_TRACKED_EMITS = 20
const CONTROL_HEIGHT_CLASS = 'h-10 md:h-8'
const ICON_CONTROL_SIZE_CLASS = 'size-10 md:size-8'

function NamedIcon({ name }: { name: string | undefined }) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

type SearchDraft = {
  draft: string
  change: (next: string) => void
  commit: (value: string) => void
  clear: () => void
}

function useSearchDraft(
  search: ListToolbarSearch | undefined,
  onSearchChange: ((value: string) => void) | undefined,
): SearchDraft {
  const applied = search?.value ?? ''
  const debounceMs = search?.debounceMs ?? LIST_TOOLBAR_DEFAULT_DEBOUNCE_MS
  const [draft, setDraft] = React.useState(applied)
  const lastSentRef = React.useRef(applied)
  const emittedRef = React.useRef<string[]>([])
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = React.useRef(onSearchChange)

  React.useEffect(() => {
    callbackRef.current = onSearchChange
  }, [onSearchChange])

  const cancel = React.useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  React.useEffect(() => cancel, [cancel])

  React.useEffect(() => {
    const emittedIndex = emittedRef.current.lastIndexOf(applied)
    if (emittedIndex >= 0) {
      emittedRef.current = emittedRef.current.slice(emittedIndex + 1)
      return
    }
    if (applied === lastSentRef.current) return
    cancel()
    emittedRef.current = []
    lastSentRef.current = applied
    setDraft(applied)
  }, [applied, cancel])

  const commit = React.useCallback(
    (value: string) => {
      cancel()
      if (value === lastSentRef.current) return
      lastSentRef.current = value
      emittedRef.current = [...emittedRef.current, value].slice(-MAX_TRACKED_EMITS)
      callbackRef.current?.(value)
    },
    [cancel],
  )

  const change = React.useCallback(
    (next: string) => {
      setDraft(next)
      cancel()
      if (debounceMs <= 0) {
        commit(next)
        return
      }
      timerRef.current = setTimeout(() => commit(next), debounceMs)
    },
    [cancel, commit, debounceMs],
  )

  const clear = React.useCallback(() => {
    setDraft('')
    commit('')
  }, [commit])

  return { draft, change, commit, clear }
}

type ScrollEdges = { start: boolean; end: boolean }

type ScrollRailProps = {
  slot: string
  label: string
  wrapFromDesktop: boolean
  className?: string
  children: React.ReactNode
}

function ScrollRail({ slot, label, wrapFromDesktop, className, children }: ScrollRailProps) {
  const railRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = React.useState<ScrollEdges>({ start: false, end: false })

  const measure = React.useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const maxScroll = rail.scrollWidth - rail.clientWidth
    const next = { start: rail.scrollLeft > 1, end: rail.scrollLeft < maxScroll - 1 }
    setEdges((current) => (current.start === next.start && current.end === next.end ? current : next))
  }, [])

  React.useEffect(() => {
    measure()
    const rail = railRef.current
    const content = contentRef.current
    if (!rail || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    observer.observe(content)
    return () => observer.disconnect()
  }, [measure])

  const fadeClass = 'pointer-events-none absolute inset-y-0 w-10 from-background to-transparent transition-opacity'

  return (
    <div
      role="group"
      aria-label={label}
      data-slot={slot}
      data-overflow-start={edges.start ? 'true' : undefined}
      data-overflow-end={edges.end ? 'true' : undefined}
      className={cn('relative min-w-0', className)}
    >
      <div
        ref={railRef}
        onScroll={measure}
        className={cn(
          'scrollbar-hide -m-1 overflow-x-auto p-1',
          wrapFromDesktop && 'md:overflow-x-visible',
        )}
      >
        <div
          ref={contentRef}
          className={cn('flex w-max items-center gap-2', wrapFromDesktop && 'md:w-auto md:flex-wrap')}
        >
          {children}
        </div>
      </div>
      <span
        aria-hidden="true"
        data-slot="list-toolbar-fade-start"
        className={cn(fadeClass, 'left-0 bg-linear-to-r', edges.start ? 'opacity-100' : 'opacity-0')}
      />
      <span
        aria-hidden="true"
        data-slot="list-toolbar-fade-end"
        className={cn(fadeClass, 'right-0 bg-linear-to-l', edges.end ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  )
}

type QuickFilterButtonProps = {
  filter: ListToolbarQuickFilter
  onToggle: ((id: string, next: boolean) => void) | undefined
}

function QuickFilterButton({ filter, onToggle }: QuickFilterButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={filter.active ? 'secondary' : 'outline'}
      aria-pressed={filter.active}
      disabled={filter.disabled === true}
      data-slot="list-toolbar-quick-filter"
      className={cn(
        CONTROL_HEIGHT_CLASS,
        'shrink-0 rounded-full border font-normal',
        filter.active && 'border-foreground',
      )}
      onClick={() => onToggle?.(filter.id, !filter.active)}
    >
      <NamedIcon name={filter.icon} />
      <span>{filter.label}</span>
      {filter.count !== undefined ? (
        <span data-slot="list-toolbar-quick-filter-count" className="tabular-nums text-muted-foreground">
          {filter.count}
        </span>
      ) : null}
    </Button>
  )
}

type FiltersButtonProps = {
  activeCount: number
  onOpen: (anchor: HTMLElement | null) => void
}

function FiltersButton({ activeCount, onOpen }: FiltersButtonProps) {
  const t = useT()
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-slot="list-toolbar-filters"
      aria-label={
        activeCount > 0
          ? t('ui.blocks.listToolbar.filtersActive', 'Filters, {count} active', { count: activeCount })
          : t('ui.blocks.listToolbar.filters', 'Filters')
      }
      className={cn(CONTROL_HEIGHT_CLASS, 'min-w-10 shrink-0 px-2 font-normal md:min-w-0 md:px-3')}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <SlidersHorizontal aria-hidden="true" className="size-4" />
      <span className="sr-only md:not-sr-only">{t('ui.blocks.listToolbar.filters', 'Filters')}</span>
      {activeCount > 0 ? (
        <Badge
          numeric
          size={20}
          variant="default"
          data-slot="list-toolbar-filters-count"
          className="min-w-5 justify-center rounded-full px-1 font-normal tabular-nums shadow-none"
        >
          {activeCount}
        </Badge>
      ) : null}
    </Button>
  )
}

type ViewSwitchProps = {
  views: ListToolbarView[]
  activeViewId: string | undefined
  onViewChange: ((id: string) => void) | undefined
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function ViewSwitch({ views, activeViewId, onViewChange }: ViewSwitchProps) {
  const t = useT()
  return (
    <div
      role="group"
      aria-label={t('ui.blocks.listToolbar.views', 'View')}
      data-slot="list-toolbar-views"
      className={cn(segmentedControlTrackVariants({ size: 'sm' }), 'h-10 shrink-0 p-0 md:h-8')}
    >
      {views.map((view) => {
        const active = view.id === activeViewId
        const Icon = resolveRegisteredLucideIcon(view.icon)
        const itemClassName = cn(
          segmentedControlItemVariants({ size: 'sm' }),
          'h-10 min-w-10 cursor-pointer gap-1 px-3 text-sm font-normal md:h-8 md:min-w-0',
          'data-[state=checked]:font-normal data-[state=checked]:ring-1 data-[state=checked]:ring-inset data-[state=checked]:ring-input',
        )
        const content = (
          <>
            {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
            <span className={Icon ? 'sr-only md:not-sr-only' : undefined}>{view.label}</span>
          </>
        )
        if (view.href) {
          return (
            <a
              key={view.id}
              href={view.href}
              aria-current={active ? 'true' : undefined}
              data-slot="list-toolbar-view"
              data-state={active ? 'checked' : 'unchecked'}
              className={itemClassName}
              onClick={(event) => {
                if (!onViewChange || event.defaultPrevented || !isPlainLeftClick(event)) return
                event.preventDefault()
                if (!active) onViewChange(view.id)
              }}
            >
              {content}
            </a>
          )
        }
        return (
          <button
            key={view.id}
            type="button"
            aria-pressed={active}
            data-slot="list-toolbar-view"
            data-state={active ? 'checked' : 'unchecked'}
            className={itemClassName}
            onClick={() => {
              if (!active) onViewChange?.(view.id)
            }}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}

function hasDisabledReason(action: BlockAction): boolean {
  return action.disabled === true && Boolean(action.disabledReason)
}

type ActionSplit = { visible: BlockAction[]; overflow: BlockAction[] }

function splitSecondaryActions(actions: BlockAction[]): ActionSplit {
  const visible: BlockAction[] = []
  const overflow: BlockAction[] = []
  for (const action of actions) {
    if (action.tone !== 'destructive' && visible.length < MAX_VISIBLE_SECONDARY_ACTIONS) visible.push(action)
    else overflow.push(action)
  }
  return { visible, overflow }
}

type ActionButtonProps = {
  action: BlockAction
  variant: 'default' | 'outline'
  pending: boolean
  reasonId: string
  onRun: (key: string) => void
}

function ActionButton({ action, variant, pending, reasonId, onRun }: ActionButtonProps) {
  const hasReason = hasDisabledReason(action)
  const ariaDisabled = hasReason && !pending
  const button = (
    <Button
      type="button"
      size="sm"
      variant={variant}
      data-slot="list-toolbar-action"
      data-action-emphasis={variant === 'default' ? 'primary' : 'secondary'}
      disabled={(action.disabled === true && !hasReason) || pending}
      aria-disabled={ariaDisabled ? 'true' : undefined}
      aria-busy={pending || undefined}
      aria-describedby={hasReason ? reasonId : undefined}
      className={cn(
        CONTROL_HEIGHT_CLASS,
        'max-w-full shrink-0 font-normal',
        variant === 'outline' && 'hidden lg:inline-flex',
        ariaDisabled &&
          'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled',
      )}
      onClick={() => {
        if (ariaDisabled) return
        onRun(action.key)
      }}
    >
      {pending ? <Spinner size="sm" /> : <NamedIcon name={action.icon} />}
      <span className="min-w-0 truncate">{action.label}</span>
    </Button>
  )
  if (!hasReason) return button
  return <SimpleTooltip content={action.disabledReason}>{button}</SimpleTooltip>
}

type ActionsMenuProps = {
  actions: BlockAction[]
  desktopVisibleKeys: ReadonlySet<string>
  pendingKeys: ReadonlySet<string>
  onRun: (key: string) => void
}

function ActionsMenu({ actions, desktopVisibleKeys, pendingKeys, onRun }: ActionsMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const anyPending = actions.some((action) => pendingKeys.has(action.key))
  const compactOnly = actions.every((action) => desktopVisibleKeys.has(action.key))
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          type="button"
          variant="outline"
          data-slot="list-toolbar-more"
          className={cn(ICON_CONTROL_SIZE_CLASS, 'shrink-0', compactOnly && 'lg:hidden')}
          disabled={anyPending}
          aria-busy={anyPending || undefined}
          aria-label={t('ui.blocks.listToolbar.moreActions', 'More actions')}
        >
          {anyPending ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden="true" />}
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        <DropdownList>
          {actions.map((action) => {
            const icon = action.icon ? <NamedIcon name={action.icon} /> : undefined
            return (
              <DropdownItem
                key={action.key}
                value={action.key}
                size={action.disabledReason ? 56 : 36}
                disabled={action.disabled === true || pendingKeys.has(action.key)}
                leading={icon}
                description={action.disabledReason}
                data-action-key={action.key}
                className={cn(
                  action.tone === 'destructive' && 'text-destructive',
                  desktopVisibleKeys.has(action.key) && 'lg:hidden',
                )}
                onSelect={() => {
                  setOpen(false)
                  onRun(action.key)
                }}
              >
                {action.label}
              </DropdownItem>
            )
          })}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}

type ChipProps = {
  chip: ListToolbarChip
  onOpen: ((id: string) => void) | undefined
  onRemove: ((id: string) => void) | undefined
}

function Chip({ chip, onOpen, onRemove }: ChipProps) {
  const t = useT()
  const removable = chip.removable !== false && onRemove !== undefined
  const labelClassName = cn('max-w-60 truncate pl-3', removable ? 'pr-1' : 'pr-3')
  return (
    <Tag
      appearance="stroke"
      data-slot="list-toolbar-chip"
      className={cn(CONTROL_HEIGHT_CLASS, 'shrink-0 gap-0 px-0 text-sm font-normal text-foreground')}
    >
      <span className="inline-flex items-center">
        {onOpen ? (
          <button
            type="button"
            title={chip.label}
            data-slot="list-toolbar-chip-label"
            className={cn(
              CONTROL_HEIGHT_CLASS,
              '-my-px cursor-pointer rounded-full outline-none focus-visible:shadow-focus',
              labelClassName,
            )}
            onClick={() => onOpen(chip.id)}
          >
            {chip.label}
          </button>
        ) : (
          <span title={chip.label} data-slot="list-toolbar-chip-label" className={labelClassName}>
            {chip.label}
          </span>
        )}
        {removable ? (
          <IconButton
            type="button"
            variant="ghost"
            fullRadius
            data-slot="list-toolbar-chip-remove"
            className={cn(ICON_CONTROL_SIZE_CLASS, '-my-px text-muted-foreground')}
            aria-label={t('ui.blocks.listToolbar.removeFilter', 'Remove filter {label}', { label: chip.label })}
            onClick={() => onRemove?.(chip.id)}
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </span>
    </Tag>
  )
}

type ChipsRowProps = {
  chips: ListToolbarChip[]
  maxVisible: number
  onChipOpen: ((id: string) => void) | undefined
  onChipRemove: ((id: string) => void) | undefined
  onAddFilter: (() => void) | undefined
  onClearAll: (() => void) | undefined
}

function ChipsRow({ chips, maxVisible, onChipOpen, onChipRemove, onAddFilter, onClearAll }: ChipsRowProps) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const hiddenCount = Math.max(0, chips.length - maxVisible)
  const visibleChips = expanded ? chips : chips.slice(0, maxVisible)
  const quietButtonClass = cn(CONTROL_HEIGHT_CLASS, 'shrink-0 rounded-full font-normal')
  return (
    <ScrollRail
      slot="list-toolbar-chips"
      label={t('ui.blocks.listToolbar.appliedFilters', 'Applied filters')}
      wrapFromDesktop
    >
      {visibleChips.map((chip) => (
        <Chip key={chip.id} chip={chip} onOpen={onChipOpen} onRemove={onChipRemove} />
      ))}
      {hiddenCount > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={expanded}
          data-slot="list-toolbar-chips-toggle"
          className={quietButtonClass}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? t('ui.blocks.listToolbar.showFewer', 'Show fewer')
            : t('ui.blocks.listToolbar.moreFilters', '+{count} more', { count: hiddenCount })}
        </Button>
      ) : null}
      {onAddFilter ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-slot="list-toolbar-add-filter"
          className={quietButtonClass}
          onClick={onAddFilter}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('ui.blocks.listToolbar.addFilter', 'Add filter')}
        </Button>
      ) : null}
      {onClearAll ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-slot="list-toolbar-clear-all"
          className={cn(quietButtonClass, 'text-muted-foreground')}
          onClick={onClearAll}
        >
          {t('ui.blocks.listToolbar.clearAll', 'Clear all')}
        </Button>
      ) : null}
    </ScrollRail>
  )
}

function ListToolbarSkeleton({ label, className }: { label: string; className: string | undefined }) {
  return (
    <div data-slot="list-toolbar" aria-busy="true" className={cn('flex flex-col gap-2', className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-full md:h-8 md:w-64" />
        <div className="flex w-full items-center gap-2 md:w-auto">
          <Skeleton className="h-10 w-20 rounded-full md:h-8" />
          <Skeleton className="h-10 w-24 rounded-full md:h-8" />
          <Skeleton className="h-10 w-16 rounded-full md:h-8" />
        </div>
        <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
          <Skeleton className="h-10 w-10 md:h-8 md:w-24" />
          <Skeleton className="h-10 w-28 md:h-8" />
          <Skeleton className="ml-auto h-10 w-24 md:ml-0 md:h-8" />
        </div>
      </div>
    </div>
  )
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'overlay') {
      return parent === document.documentElement || parent === document.body ? null : parent
    }
  }
  return null
}

function useStuck(
  enabled: boolean,
  stickyOffset: string,
  barRef: React.RefObject<HTMLDivElement | null>,
  sentinelRef: React.RefObject<HTMLSpanElement | null>,
): boolean {
  const [stuck, setStuck] = React.useState(false)
  React.useEffect(() => {
    const bar = barRef.current
    const sentinel = sentinelRef.current
    if (!enabled || !bar || !sentinel || typeof IntersectionObserver === 'undefined') {
      setStuck(false)
      return
    }
    const resolvedTop = Number.parseFloat(getComputedStyle(bar).top)
    const offset = Number.isFinite(resolvedTop) ? resolvedTop + 1 : 0
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        const rootTop = entry.rootBounds ? entry.rootBounds.top : offset
        setStuck(entry.intersectionRatio < 1 && entry.boundingClientRect.top < rootTop)
      },
      { root: findScrollParent(bar), rootMargin: `${-offset}px 0px 0px 0px`, threshold: [1] },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [barRef, enabled, sentinelRef, stickyOffset])
  return stuck
}

export function ListToolbar(props: ListToolbarProps) {
  const t = useT()
  const {
    ariaLabel,
    search,
    onSearchChange,
    quickFilters,
    onQuickFilterToggle,
    filtersActiveCount,
    onOpenFilters,
    chips,
    onChipOpen,
    onChipRemove,
    onAddFilter,
    onClearAll,
    maxVisibleChips,
    views,
    activeViewId,
    onViewChange,
    primaryAction,
    secondaryActions,
    onAction,
    resultSummary,
    busy,
    sticky,
    stickyOffset,
    leading,
    searchTrailing,
    trailing,
    status,
    className,
  } = props
  const reasonIdBase = React.useId()
  const barRef = React.useRef<HTMLDivElement | null>(null)
  const sentinelRef = React.useRef<HTMLSpanElement | null>(null)
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const [pendingKeys, setPendingKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const searchDraft = useSearchDraft(search, onSearchChange)
  const isLoading = status === 'loading'
  const isSticky = sticky === 'top' && !isLoading
  const resolvedStickyOffset = stickyOffset ?? LIST_TOOLBAR_DEFAULT_STICKY_OFFSET
  const stuck = useStuck(isSticky, resolvedStickyOffset, barRef, sentinelRef)

  const runAction = React.useCallback(
    (key: string) => {
      const result = onAction?.(key)
      if (!result || typeof (result as Promise<void>).then !== 'function') return
      setPendingKeys((current) => new Set(current).add(key))
      const clear = () =>
        setPendingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      ;(result as Promise<void>).then(clear, clear)
    },
    [onAction],
  )

  const split = React.useMemo(() => splitSecondaryActions(secondaryActions ?? []), [secondaryActions])
  const desktopVisibleKeys = React.useMemo(
    () => new Set(split.visible.map((action) => action.key)),
    [split.visible],
  )

  if (isLoading) {
    return <ListToolbarSkeleton label={t('ui.blocks.listToolbar.loading', 'Loading')} className={className} />
  }

  const reasonIdFor = (action: BlockAction) => `${reasonIdBase}-${action.key}`
  const hasQuickFilters = Boolean(quickFilters && quickFilters.length > 0)
  const hasViews = Boolean(views && views.length > 0)
  const hasChips = Boolean(chips && chips.length > 0)
  const hasSecondary = Boolean(secondaryActions && secondaryActions.length > 0)
  const hasActionGroup = hasSecondary || Boolean(primaryAction) || Boolean(trailing)
  const hasSearchCluster = Boolean(search) || Boolean(leading) || Boolean(searchTrailing) || busy === true
  const hasEndCluster = Boolean(resultSummary) || Boolean(onOpenFilters) || hasViews || hasActionGroup
  const showClear = searchDraft.draft.length > 0
  const searchLabel = search?.label ?? t('ui.blocks.listToolbar.searchLabel', 'Search')
  const busyIndicator = (
    <span
      role="status"
      data-slot="list-toolbar-busy"
      className={cn(
        'inline-flex shrink-0 items-center',
        search && 'pointer-events-none absolute inset-y-0',
        search && (showClear ? 'right-10 md:right-8' : 'right-3'),
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        <Spinner size="sm" />
      </span>
      <span className="sr-only">{t('ui.blocks.listToolbar.busy', 'Updating results')}</span>
    </span>
  )

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={ariaLabel ?? t('ui.blocks.listToolbar.label', 'List toolbar')}
      data-slot="list-toolbar"
      data-sticky={isSticky ? 'top' : undefined}
      data-stuck={stuck ? 'true' : undefined}
      data-busy={busy ? 'true' : undefined}
      style={isSticky ? { top: `calc(${resolvedStickyOffset} - 1px)` } : undefined}
      className={cn(
        'flex flex-col gap-2',
        isSticky && 'sticky z-sticky border-b border-transparent bg-background py-2 transition-shadow',
        isSticky && stuck && 'border-border shadow-sm',
        className,
      )}
    >
      {isSticky ? (
        <span
          ref={sentinelRef}
          aria-hidden="true"
          data-slot="list-toolbar-sentinel"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
        />
      ) : null}
      <div data-slot="list-toolbar-main" className="flex flex-wrap items-center gap-2">
        {hasSearchCluster ? (
          <div data-slot="list-toolbar-search" className="flex w-full min-w-0 items-center gap-2 md:w-auto">
            {leading ? (
              <div data-slot="list-toolbar-leading" className="flex shrink-0 items-center">
                {leading}
              </div>
            ) : null}
            {search ? (
              <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
                <SearchInput
                  ref={searchInputRef}
                  value={searchDraft.draft}
                  onChange={searchDraft.change}
                  clearable={false}
                  placeholder={search.placeholder}
                  aria-label={searchLabel}
                  className={cn(CONTROL_HEIGHT_CLASS, 'w-full')}
                  inputClassName={cn(
                    showClear && 'pr-8 md:pr-6',
                    busy && (showClear ? 'pr-14 md:pr-12' : 'pr-6'),
                  )}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    searchDraft.commit(searchDraft.draft)
                  }}
                />
                {busy ? busyIndicator : null}
                {showClear ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    data-slot="list-toolbar-search-clear"
                    className={cn(ICON_CONTROL_SIZE_CLASS, 'absolute right-0 top-0 text-muted-foreground')}
                    aria-label={t('ui.blocks.listToolbar.clearSearch', 'Clear search')}
                    onClick={() => {
                      searchDraft.clear()
                      searchInputRef.current?.focus()
                    }}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                ) : null}
              </div>
            ) : busy ? (
              busyIndicator
            ) : null}
            {searchTrailing ? (
              <div data-slot="list-toolbar-search-trailing" className="flex shrink-0 items-center">
                {searchTrailing}
              </div>
            ) : null}
          </div>
        ) : null}
        {hasQuickFilters ? (
          <ScrollRail
            slot="list-toolbar-quick-filters"
            label={t('ui.blocks.listToolbar.quickFilters', 'Quick filters')}
            wrapFromDesktop={false}
            className="w-full md:w-auto md:max-w-full md:flex-none"
          >
            {(quickFilters ?? []).map((filter) => (
              <QuickFilterButton key={filter.id} filter={filter} onToggle={onQuickFilterToggle} />
            ))}
          </ScrollRail>
        ) : null}
        {hasEndCluster ? (
          <div
            data-slot="list-toolbar-end"
            className="flex w-full min-w-0 flex-wrap items-center gap-2 md:ml-auto md:w-auto md:max-w-full md:justify-end"
          >
            {resultSummary ? (
              <p
                aria-live="polite"
                data-slot="list-toolbar-summary"
                className="order-last w-full text-sm tabular-nums text-muted-foreground md:order-none md:w-auto md:shrink-0"
              >
                {resultSummary}
              </p>
            ) : null}
            {onOpenFilters ? <FiltersButton activeCount={filtersActiveCount ?? 0} onOpen={onOpenFilters} /> : null}
            {hasViews ? (
              <ViewSwitch views={views ?? []} activeViewId={activeViewId} onViewChange={onViewChange} />
            ) : null}
            {hasActionGroup ? (
              <div data-slot="list-toolbar-actions" className="ml-auto flex min-w-0 items-center gap-2 md:ml-0">
                {split.visible.map((action) => (
                  <ActionButton
                    key={action.key}
                    action={action}
                    variant="outline"
                    pending={pendingKeys.has(action.key)}
                    reasonId={reasonIdFor(action)}
                    onRun={runAction}
                  />
                ))}
                {hasSecondary ? (
                  <ActionsMenu
                    actions={secondaryActions ?? []}
                    desktopVisibleKeys={desktopVisibleKeys}
                    pendingKeys={pendingKeys}
                    onRun={runAction}
                  />
                ) : null}
                {primaryAction ? (
                  <ActionButton
                    action={primaryAction}
                    variant="default"
                    pending={pendingKeys.has(primaryAction.key)}
                    reasonId={reasonIdFor(primaryAction)}
                    onRun={runAction}
                  />
                ) : null}
                {trailing ? (
                  <div data-slot="list-toolbar-trailing" className="flex min-w-0 items-center">
                    {trailing}
                  </div>
                ) : null}
              </div>
            ) : null}
            {split.visible.filter(hasDisabledReason).map((action) => (
              <p key={action.key} id={reasonIdFor(action)} className="sr-only">
                {action.disabledReason}
              </p>
            ))}
            {primaryAction && hasDisabledReason(primaryAction) ? (
              <p
                id={reasonIdFor(primaryAction)}
                data-slot="list-toolbar-action-reason"
                className="w-full text-right text-xs leading-5 text-muted-foreground md:sr-only"
              >
                {primaryAction.disabledReason}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {hasChips ? (
        <ChipsRow
          chips={chips ?? []}
          maxVisible={maxVisibleChips ?? LIST_TOOLBAR_DEFAULT_MAX_VISIBLE_CHIPS}
          onChipOpen={onChipOpen}
          onChipRemove={onChipRemove}
          onAddFilter={onAddFilter}
          onClearAll={onClearAll}
        />
      ) : null}
    </div>
  )
}
