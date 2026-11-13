"use client"

import * as React from 'react'
import { Users, Link2, Plus } from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  readVersionedIdSet,
  writeVersionedIdSet,
} from '@open-mercato/shared/lib/browser/versionedPreference'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { TabEmptyStateConfig, Translator } from './types'
import {
  PersonEmailCell,
  PersonLifecycleStageCell,
  PersonLinkedDateCell,
  PersonNameCell,
  PersonPhoneCell,
  PersonSourceCell,
  buildPersonRowActionItems,
} from './PersonCard'
import {
  LinkEntityDialog,
  type LinkEntityAdapter,
  type LinkEntityConfirmInput,
} from '../linking/LinkEntityDialog'

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type LinkedPersonSummary = {
  id: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  status?: string | null
  lifecycleStage?: string | null
  jobTitle?: string | null
  department?: string | null
  createdAt?: string | null
  organizationId?: string | null
  temperature?: string | null
  source?: string | null
  linkedAt?: string | null
}

export type LinkedPeopleSortMode = 'name-asc' | 'name-desc' | 'recent'

export const ALL_LINKED_PEOPLE_SORTS: LinkedPeopleSortMode[] = ['name-asc', 'name-desc', 'recent']

export type LinkedPeoplePage = {
  items?: LinkedPersonSummary[]
  page?: number
  total?: number
  totalPages?: number
}

export type LinkedPeopleSectionProps<
  TDetails = unknown,
  TLinkSettings = Record<string, unknown>,
> = {
  /** Stable id of the owning record; scopes browser-local preferences such as starred people. */
  scopeId: string
  /** Records the host already knows about, used until the first page load resolves. */
  fallbackPeople?: LinkedPersonSummary[]
  loadPage: (params: {
    page: number
    pageSize: number
    sort: LinkedPeopleSortMode
    search: string
  }) => Promise<LinkedPeoplePage>
  /** Owns messaging and optimistic-lock handling for the unlink write. */
  onUnlink: (personId: string) => Promise<void>
  linkAdapter: LinkEntityAdapter<TDetails, TLinkSettings>
  /** Controlled link-dialog state; falls back to internal state when omitted. */
  linkDialogOpen?: boolean
  onLinkDialogOpenChange?: (open: boolean) => void
  linkedIds?: string[]
  /** Owns messaging for the link write; rejecting keeps the link dialog open. */
  onLinkConfirm: (input: LinkEntityConfirmInput<TLinkSettings>) => Promise<void>
  sectionTitle: string
  /**
   * Line rendered under the section title.
   *
   * @deprecated The built-in company and deal sections no longer show a subtitle. Move the text out
   * of the section, for example into `header`. This prop stays for at least one minor release.
   */
  sectionSubtitle?: string
  searchPlaceholder: string
  linkActionLabel: string
  addActionLabel?: string
  onAddPerson?: () => void
  emptyLabel: string
  emptyState: TabEmptyStateConfig
  onEmptyStateAction?: () => void
  /**
   * Which sort options to offer, in order. Defaults to all three.
   *
   * A host whose `linkedAt` is not trustworthy must omit `recent`: the deal side does so until
   * `syncDealPeople` stops re-dating every surviving link on each write, because the ordering
   * would otherwise collapse into an arbitrary label tie-break.
   */
  availableSorts?: LinkedPeopleSortMode[]
  /** Shows the Linked column; a host without a durable `linkedAt` passes `false`. */
  showLinkedDate?: boolean
  /** Bump to force a reload after the host mutates the links itself. */
  refreshKey?: number
  disabled?: boolean
  translator?: Translator
  runGuardedMutation?: GuardedMutationRunner
  onLoadingChange?: (isLoading: boolean) => void
  header?: React.ReactNode
  renderFooter?: (ctx: {
    people: LinkedPersonSummary[]
    starredIds: Set<string>
  }) => React.ReactNode
}

const LINKED_PEOPLE_PAGE_SIZE = 20
const STARRED_PEOPLE_STORAGE_VERSION = 1

const CELL_PADDING_PX = 32
const ACTIONS_COLUMN_WIDTH_PX = 96
const NAME_COLUMN_MIN_WIDTH_PX = 120

const EMAIL_LINKED_MIN_CONTAINER_PX = 576
const PHONE_MIN_CONTAINER_PX = 768
const LIFECYCLE_MIN_CONTAINER_PX = 896
const SOURCE_MIN_CONTAINER_PX = 1024
const CONTAINER_BREAKPOINTS_PX = [
  EMAIL_LINKED_MIN_CONTAINER_PX,
  PHONE_MIN_CONTAINER_PX,
  LIFECYCLE_MIN_CONTAINER_PX,
  SOURCE_MIN_CONTAINER_PX,
]

const EMAIL_COLUMN_WIDTH_PX = 192
const EMAIL_COLUMN_WIDE_WIDTH_PX = 224
const PHONE_COLUMN_WIDTH_PX = 144
const LIFECYCLE_COLUMN_WIDTH_PX = 128
const SOURCE_COLUMN_WIDTH_PX = 160
const LINKED_COLUMN_WIDTH_PX = 112

const SORT_LABELS: Record<LinkedPeopleSortMode, { key: string; fallback: string }> = {
  'name-asc': { key: 'customers.linkedPeople.sortNameAsc', fallback: 'Sort: Name A-Z' },
  'name-desc': { key: 'customers.linkedPeople.sortNameDesc', fallback: 'Sort: Name Z-A' },
  recent: { key: 'customers.linkedPeople.sortRecent', fallback: 'Sort: Recently linked' },
}

function toSortMode(sorting: SortingState, fallback: LinkedPeopleSortMode): LinkedPeopleSortMode {
  const [primary] = sorting
  if (primary?.id === 'linkedAt') return 'recent'
  if (primary?.id === 'displayName') return primary.desc ? 'name-desc' : 'name-asc'
  return fallback
}

function toAllowedSortMode(
  requested: LinkedPeopleSortMode,
  allowed: LinkedPeopleSortMode[],
  fallback: LinkedPeopleSortMode,
): LinkedPeopleSortMode {
  if (allowed.includes(requested)) return requested
  if (requested === 'name-asc' && allowed.includes('name-desc')) return 'name-desc'
  if (requested === 'name-desc' && allowed.includes('name-asc')) return 'name-asc'
  return fallback
}

function toSortingState(sortMode: LinkedPeopleSortMode): SortingState {
  if (sortMode === 'recent') return [{ id: 'linkedAt', desc: true }]
  return [{ id: 'displayName', desc: sortMode === 'name-desc' }]
}

function resolveContainerBreakpoint(width: number): number | null {
  if (width <= 0) return null
  return CONTAINER_BREAKPOINTS_PX.filter((breakpoint) => width >= breakpoint).at(-1) ?? 0
}

/**
 * The widest container breakpoint the element reaches, or `null` until it has a measurable width.
 * `DataTable` takes no per-column classes, so the columns themselves collapse from this value.
 */
function useContainerBreakpoint(element: HTMLElement | null): number | null {
  const [breakpoint, setBreakpoint] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    if (!element) return
    setBreakpoint(resolveContainerBreakpoint(element.getBoundingClientRect().width))
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setBreakpoint(resolveContainerBreakpoint(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return breakpoint
}

type StarredPeopleContextValue = {
  starredIds: Set<string>
  toggleStar: (personId: string) => void
}

const StarredPeopleContext = React.createContext<StarredPeopleContextValue | null>(null)

/** Reads the stars from context: a column definition that changes with them would remount the cell and drop focus. */
function StarrablePersonNameCell({ person }: { person: LinkedPersonSummary }) {
  const starred = React.useContext(StarredPeopleContext)
  return (
    <PersonNameCell
      person={person}
      isStarred={starred?.starredIds.has(person.id)}
      onToggleStar={starred?.toggleStar}
    />
  )
}

/** `DataTable` does not expose its header cell, so the sort state reaches `aria-sort` from inside it. */
function SortableColumnLabel({ label, sorted }: { label: string; sorted: false | 'asc' | 'desc' }) {
  const labelRef = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
    labelRef.current?.closest('th')?.setAttribute('aria-sort', ariaSort)
  }, [sorted])
  return <span ref={labelRef}>{label}</span>
}

export function LinkedPeopleSection<
  TDetails = unknown,
  TLinkSettings = Record<string, unknown>,
>({
  scopeId,
  fallbackPeople,
  loadPage,
  onUnlink,
  linkAdapter,
  linkDialogOpen: controlledLinkDialogOpen,
  onLinkDialogOpenChange,
  linkedIds,
  onLinkConfirm,
  sectionTitle,
  sectionSubtitle,
  searchPlaceholder,
  linkActionLabel,
  addActionLabel,
  onAddPerson,
  emptyLabel,
  emptyState,
  onEmptyStateAction,
  availableSorts = ALL_LINKED_PEOPLE_SORTS,
  showLinkedDate = true,
  refreshKey = 0,
  disabled = false,
  translator,
  runGuardedMutation,
  onLoadingChange,
  header,
  renderFooter,
}: LinkedPeopleSectionProps<TDetails, TLinkSettings>) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(
    () => createTranslatorWithFallback(tHook),
    [tHook],
  )
  const translate: Translator = translator ?? fallbackTranslator
  const knownPeople = React.useMemo(() => fallbackPeople ?? [], [fallbackPeople])
  const sortOptions = availableSorts.length > 0 ? availableSorts : ALL_LINKED_PEOPLE_SORTS

  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [internalLinkDialogOpen, setInternalLinkDialogOpen] = React.useState(false)
  const linkDialogOpen = controlledLinkDialogOpen ?? internalLinkDialogOpen
  const setLinkDialogOpen = React.useCallback(
    (open: boolean) => {
      setInternalLinkDialogOpen(open)
      onLinkDialogOpenChange?.(open)
    },
    [onLinkDialogOpenChange],
  )
  const [searchQuery, setSearchQuery] = React.useState('')
  const defaultSortMode = sortOptions[0]
  const [sorting, setSorting] = React.useState<SortingState>(() => toSortingState(defaultSortMode))
  const sortMode = toAllowedSortMode(toSortMode(sorting, defaultSortMode), sortOptions, defaultSortMode)
  const hasSortChoice = sortOptions.length > 1
  const nameSortable = hasSortChoice && (sortOptions.includes('name-asc') || sortOptions.includes('name-desc'))
  const recentSortable = hasSortChoice && sortOptions.includes('recent')
  const [visiblePeople, setVisiblePeople] = React.useState<LinkedPersonSummary[]>([])
  const [listPage, setListPage] = React.useState(1)
  const [listTotalPages, setListTotalPages] = React.useState(1)
  const [listTotalCount, setListTotalCount] = React.useState(knownPeople.length)
  const [listResultCount, setListResultCount] = React.useState(0)
  const [tableContainer, setTableContainer] = React.useState<HTMLDivElement | null>(null)
  const containerBreakpoint = useContainerBreakpoint(tableContainer)
  const [listLoading, setListLoading] = React.useState(true)
  const [starredIds, setStarredIds] = React.useState<Set<string>>(
    () => readVersionedIdSet(`om:starred-people:${scopeId}`, STARRED_PEOPLE_STORAGE_VERSION),
  )

  const toggleStar = React.useCallback(
    (personId: string) => {
      setStarredIds((prev) => {
        const next = new Set(prev)
        if (next.has(personId)) next.delete(personId)
        else next.add(personId)
        writeVersionedIdSet(`om:starred-people:${scopeId}`, STARRED_PEOPLE_STORAGE_VERSION, next)
        return next
      })
    },
    [scopeId],
  )

  const starredPeople = React.useMemo(() => ({ starredIds, toggleStar }), [starredIds, toggleStar])

  const displayedPeople = React.useMemo(
    () => (visiblePeople.length > 0 ? visiblePeople : knownPeople),
    [knownPeople, visiblePeople],
  )
  const totalLinkedPeople = listTotalCount > 0 ? listTotalCount : displayedPeople.length

  const loadVisiblePeople = React.useCallback(async () => {
    setListLoading(true)
    try {
      const payload = await loadPage({
        page: listPage,
        pageSize: LINKED_PEOPLE_PAGE_SIZE,
        sort: sortMode,
        search: searchQuery.trim(),
      })
      const nextTotalCount = typeof payload.total === 'number' ? payload.total : 0
      setVisiblePeople(Array.isArray(payload.items) ? payload.items : [])
      setListPage(typeof payload.page === 'number' ? payload.page : listPage)
      setListResultCount(nextTotalCount)
      setListTotalCount((current) =>
        searchQuery.trim().length > 0 ? Math.max(current, nextTotalCount) : nextTotalCount,
      )
      setListTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
    } catch {
      setVisiblePeople([])
      setListResultCount(0)
      if (searchQuery.trim().length === 0) {
        setListTotalCount(0)
      }
      setListTotalPages(1)
    } finally {
      setListLoading(false)
    }
  }, [listPage, loadPage, searchQuery, sortMode])

  React.useEffect(() => {
    void loadVisiblePeople()
  }, [loadVisiblePeople, refreshKey])

  React.useEffect(() => {
    setListPage(1)
  }, [searchQuery, sortMode])

  const handleLinkConfirm = React.useCallback(
    async (input: LinkEntityConfirmInput<TLinkSettings>) => {
      onLoadingChange?.(true)
      try {
        await onLinkConfirm(input)
        await loadVisiblePeople()
      } finally {
        onLoadingChange?.(false)
      }
    },
    [loadVisiblePeople, onLinkConfirm, onLoadingChange],
  )

  const handleRemove = React.useCallback(
    async (personId: string) => {
      if (!personId || removingId) return
      setRemovingId(personId)
      onLoadingChange?.(true)
      try {
        await onUnlink(personId)
        await loadVisiblePeople()
      } catch {
        // onUnlink owns user-facing error reporting
      } finally {
        setRemovingId(null)
        onLoadingChange?.(false)
      }
    },
    [loadVisiblePeople, onLoadingChange, onUnlink, removingId],
  )

  const handleSortingChange = React.useCallback(
    (next: SortingState) => {
      setSorting(toSortingState(toAllowedSortMode(toSortMode(next, defaultSortMode), sortOptions, defaultSortMode)))
    },
    [defaultSortMode, sortOptions],
  )

  // The Linked header is the only place the table offers the recency sort. Once the column
  // collapses out of a narrow container the choice moves to a compact control, so a phone
  // width still reaches every mode the host allows.
  const linkedColumnVisible = showLinkedDate
    && (containerBreakpoint === null || containerBreakpoint >= EMAIL_LINKED_MIN_CONTAINER_PX)
  const showCompactSort = recentSortable && !linkedColumnVisible
  const handleCompactSortChange = React.useCallback(
    (value: string) => {
      const requested = sortOptions.find((option) => option === value)
      if (requested) setSorting(toSortingState(requested))
    },
    [sortOptions],
  )

  const columns = React.useMemo<ColumnDef<LinkedPersonSummary>[]>(() => {
    const fits = (minContainerWidth: number) =>
      containerBreakpoint === null || containerBreakpoint >= minContainerWidth
    const showEmail = fits(EMAIL_LINKED_MIN_CONTAINER_PX)
    const showPhone = fits(PHONE_MIN_CONTAINER_PX)
    const showLifecycle = fits(LIFECYCLE_MIN_CONTAINER_PX)
    const showSource = fits(SOURCE_MIN_CONTAINER_PX)
    const showLinked = linkedColumnVisible
    const emailWidth = fits(PHONE_MIN_CONTAINER_PX) ? EMAIL_COLUMN_WIDE_WIDTH_PX : EMAIL_COLUMN_WIDTH_PX
    const reservedWidth = ACTIONS_COLUMN_WIDTH_PX + CELL_PADDING_PX
      + (showEmail ? emailWidth : 0)
      + (showPhone ? PHONE_COLUMN_WIDTH_PX : 0)
      + (showLifecycle ? LIFECYCLE_COLUMN_WIDTH_PX : 0)
      + (showSource ? SOURCE_COLUMN_WIDTH_PX : 0)
      + (showLinked ? LINKED_COLUMN_WIDTH_PX : 0)
    const nameLabel = translate('customers.people.list.columns.name', 'Name')
    const linkedLabel = translate('customers.linkedPeople.columns.linked', 'Linked')

    const nameColumn: ColumnDef<LinkedPersonSummary> = {
      id: 'displayName',
      accessorKey: 'displayName',
      enableSorting: nameSortable,
      header: nameSortable
        ? ({ column }) => <SortableColumnLabel label={nameLabel} sorted={column.getIsSorted()} />
        : nameLabel,
      meta: { maxWidth: `max(${NAME_COLUMN_MIN_WIDTH_PX}px, 100cqw - ${reservedWidth}px)` },
      cell: ({ row }) => <StarrablePersonNameCell person={row.original} />,
    }
    const emailColumn: ColumnDef<LinkedPersonSummary> = {
      id: 'primaryEmail',
      accessorKey: 'primaryEmail',
      enableSorting: false,
      header: translate('customers.people.list.columns.email', 'Email'),
      meta: { maxWidth: `${emailWidth - CELL_PADDING_PX}px` },
      cell: ({ row }) => <PersonEmailCell person={row.original} />,
    }
    const phoneColumn: ColumnDef<LinkedPersonSummary> = {
      id: 'primaryPhone',
      accessorKey: 'primaryPhone',
      enableSorting: false,
      header: translate('customers.linkedPeople.columns.phone', 'Phone'),
      meta: { truncate: false },
      cell: ({ row }) => <PersonPhoneCell person={row.original} />,
    }
    const lifecycleColumn: ColumnDef<LinkedPersonSummary> = {
      id: 'lifecycleStage',
      accessorKey: 'lifecycleStage',
      enableSorting: false,
      header: translate('customers.people.list.columns.lifecycleStage', 'Lifecycle stage'),
      meta: { maxWidth: `${LIFECYCLE_COLUMN_WIDTH_PX - CELL_PADDING_PX}px` },
      cell: ({ row }) => <PersonLifecycleStageCell person={row.original} />,
    }
    const sourceColumn: ColumnDef<LinkedPersonSummary> = {
      id: 'source',
      accessorKey: 'source',
      enableSorting: false,
      header: translate('customers.people.list.columns.source', 'Source'),
      meta: { maxWidth: `${SOURCE_COLUMN_WIDTH_PX - CELL_PADDING_PX}px` },
      cell: ({ row }) => <PersonSourceCell person={row.original} />,
    }
    const linkedColumn: ColumnDef<LinkedPersonSummary> = {
      id: 'linkedAt',
      accessorKey: 'linkedAt',
      enableSorting: recentSortable,
      header: recentSortable
        ? ({ column }) => <SortableColumnLabel label={linkedLabel} sorted={column.getIsSorted()} />
        : linkedLabel,
      meta: { truncate: false },
      cell: ({ row }) => <PersonLinkedDateCell person={row.original} />,
    }

    return [
      nameColumn,
      ...(showEmail ? [emailColumn] : []),
      ...(showPhone ? [phoneColumn] : []),
      ...(showLifecycle ? [lifecycleColumn] : []),
      ...(showSource ? [sourceColumn] : []),
      ...(showLinked ? [linkedColumn] : []),
    ]
  }, [containerBreakpoint, linkedColumnVisible, nameSortable, recentSortable, translate])

  const linkAction = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setLinkDialogOpen(true)}
      disabled={disabled}
    >
      <Link2 className="mr-1.5 h-4 w-4" />
      {linkActionLabel}
    </Button>
  )
  const addPersonAction = onAddPerson && addActionLabel ? (
    <Button type="button" size="sm" onClick={onAddPerson} disabled={disabled}>
      <Plus className="mr-1.5 h-4 w-4" />
      {addActionLabel}
    </Button>
  ) : null

  const linkDialog = (
    <LinkEntityDialog
      open={linkDialogOpen}
      onOpenChange={setLinkDialogOpen}
      adapter={linkAdapter}
      initialSelectedIds={linkedIds ?? []}
      onConfirm={handleLinkConfirm}
      runGuardedMutation={runGuardedMutation}
    />
  )

  if (!listLoading && totalLinkedPeople === 0) {
    const emptyStateAction = onEmptyStateAction ?? onAddPerson
    return (
      <>
        {header}
        <EmptyState
          icon={<Users className="h-10 w-10 text-muted-foreground" />}
          title={emptyState.title}
          actionLabel={emptyStateAction ? emptyState.actionLabel : undefined}
          onAction={emptyStateAction}
        >
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          <div className="mt-4">{linkAction}</div>
        </EmptyState>
        {linkDialog}
      </>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {header}

        <section>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{sectionTitle}</h3>
                  <Badge
                    variant="secondary"
                    className="rounded-full px-2 py-0 text-xs font-semibold"
                  >
                    {totalLinkedPeople}
                  </Badge>
                </div>
                {sectionSubtitle ? (
                  <p className="text-xs text-muted-foreground">{sectionSubtitle}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {showCompactSort ? (
                  <Select value={sortMode} onValueChange={handleCompactSortChange}>
                    <SelectTrigger
                      size="sm"
                      aria-label={translate('customers.linkedPeople.sortLabel', 'Sort order')}
                      className="w-auto"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {translate(SORT_LABELS[option].key, SORT_LABELS[option].fallback)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {linkAction}
                {addPersonAction}
              </div>
            </div>

            <div ref={setTableContainer} className="@container -m-1 min-w-0 overflow-x-auto p-1 [&_table]:min-w-0">
              <StarredPeopleContext.Provider value={starredPeople}>
                <DataTable<LinkedPersonSummary>
                  embedded
                  extensionTableId="customers.linked_people.list"
                  columns={columns}
                  data={visiblePeople}
                  isLoading={listLoading}
                  sortable
                  manualSorting
                  sorting={sorting}
                  onSortingChange={handleSortingChange}
                  searchValue={searchQuery}
                  onSearchChange={totalLinkedPeople > 0 ? setSearchQuery : undefined}
                  searchPlaceholder={searchPlaceholder}
                  disableRowClick
                  showQueryTime={false}
                  emptyState={emptyLabel}
                  rowActions={(person) => (
                    <RowActions items={buildPersonRowActionItems(person, translate, handleRemove)} />
                  )}
                  pagination={
                    listTotalPages > 1
                      ? {
                          page: listPage,
                          pageSize: LINKED_PEOPLE_PAGE_SIZE,
                          total: listResultCount,
                          totalPages: listTotalPages,
                          onPageChange: setListPage,
                        }
                      : undefined
                  }
                />
              </StarredPeopleContext.Provider>
            </div>
          </div>
        </section>

        {renderFooter?.({ people: displayedPeople, starredIds })}
      </div>

      {linkDialog}
    </>
  )
}

export default LinkedPeopleSection
