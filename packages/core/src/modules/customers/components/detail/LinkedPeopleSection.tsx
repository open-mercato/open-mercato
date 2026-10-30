"use client"

import * as React from 'react'
import { Users, Link2, Plus, Filter } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  readVersionedIdSet,
  writeVersionedIdSet,
} from '@open-mercato/shared/lib/browser/versionedPreference'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { TabEmptyStateConfig, Translator } from './types'
import { PersonCard } from './PersonCard'
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
  /** Forwarded to `PersonCard`; a host without a durable `linkedAt` passes `false`. */
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

const SORT_LABELS: Record<LinkedPeopleSortMode, { key: string; fallback: string }> = {
  'name-asc': { key: 'customers.linkedPeople.sortNameAsc', fallback: 'Sort: Name A-Z' },
  'name-desc': { key: 'customers.linkedPeople.sortNameDesc', fallback: 'Sort: Name Z-A' },
  recent: { key: 'customers.linkedPeople.sortRecent', fallback: 'Sort: Recently linked' },
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
  const [sortMode, setSortMode] = React.useState<LinkedPeopleSortMode>(sortOptions[0])
  const [filtersOpen, setFiltersOpen] = React.useState(true)
  const [visiblePeople, setVisiblePeople] = React.useState<LinkedPersonSummary[]>([])
  const [listPage, setListPage] = React.useState(1)
  const [listTotalPages, setListTotalPages] = React.useState(1)
  const [listTotalCount, setListTotalCount] = React.useState(knownPeople.length)
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
      setListTotalCount((current) =>
        searchQuery.trim().length > 0 ? Math.max(current, nextTotalCount) : nextTotalCount,
      )
      setListTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
    } catch {
      setVisiblePeople([])
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

        <section className="rounded-lg border bg-card px-4 py-4 sm:px-5">
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
                {linkAction}
                {addPersonAction}
              </div>
            </div>

            {totalLinkedPeople > 0 ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                {filtersOpen ? (
                  <div className="min-w-0 flex-1">
                    <Input
                      type="text"
                      size="lg"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={searchPlaceholder}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFiltersOpen((current) => !current)}
                    className="h-10"
                  >
                    <Filter className="mr-1.5 h-4 w-4" />
                    {translate('customers.linkedPeople.filter', 'Filters')}
                  </Button>
                  {/*
                    Deliberately a native <select> rather than the DS `Select`. That primitive is
                    Radix-based (a button + listbox), and this element is the one the extraction
                    gate runs through: `CompanyPeopleSection.test.tsx` must keep passing
                    unmodified, and it drives the sort with `getByDisplayValue` + `fireEvent
                    .change` — native-select APIs. Swapping it would also change the company
                    tab's keyboard and mobile-picker behaviour, which is the one thing this PR
                    asserts it does not do. Worth migrating, but as its own change.
                  */}
                  {filtersOpen && sortOptions.length > 1 ? (
                    <select
                      value={sortMode}
                      onChange={(event) =>
                        setSortMode(event.target.value as LinkedPeopleSortMode)
                      }
                      className="h-10 min-w-44 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {sortOptions.map((option) => (
                        <option key={option} value={option}>
                          {translate(SORT_LABELS[option].key, SORT_LABELS[option].fallback)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
            ) : null}

            {listLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {translate('customers.linkedPeople.loading', 'Loading people…')}
              </p>
            ) : visiblePeople.length > 0 ? (
              <>
                <div
                  className="grid items-start gap-4"
                  style={{
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 19.5rem), 1fr))',
                  }}
                >
                  {visiblePeople.map((person) => (
                    <PersonCard
                      key={person.id}
                      person={person}
                      isStarred={starredIds.has(person.id)}
                      onToggleStar={toggleStar}
                      onUnlink={handleRemove}
                      showLinkedDate={showLinkedDate}
                    />
                  ))}
                </div>
                {listTotalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    <span>
                      {translate(
                        'customers.linkedPeople.pageSummary',
                        'Page {{page}} of {{total}}',
                        {
                          page: listPage,
                          total: listTotalPages,
                        },
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setListPage((current) => Math.max(1, current - 1))}
                        disabled={listPage <= 1}
                      >
                        {translate('customers.linkedPeople.previous', 'Previous')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setListPage((current) => Math.min(listTotalPages, current + 1))
                        }
                        disabled={listPage >= listTotalPages}
                      >
                        {translate('customers.linkedPeople.next', 'Next')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : totalLinkedPeople > 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {translate(
                  'customers.linkedPeople.noSearchResults',
                  'No people match your search.',
                )}
              </p>
            ) : null}
          </div>
        </section>

        {renderFooter?.({ people: displayedPeople, starredIds })}
      </div>

      {linkDialog}
    </>
  )
}

export default LinkedPeopleSection
