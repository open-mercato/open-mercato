"use client"

import * as React from 'react'
import { Users, Loader2, Link2, Plus, Filter } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'
import type { SectionAction, TabEmptyStateConfig, Translator } from './types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { CreatePersonDialog } from './CreatePersonDialog'
import { PersonCard } from './PersonCard'
import { DecisionMakersFooter } from './DecisionMakersFooter'
import { RolesSection } from './RolesSection'

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type CompanyPersonSummary = {
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

export type CompanyPeopleSectionProps = {
  companyId: string
  companyName?: string
  initialPeople: CompanyPersonSummary[]
  addActionLabel: string
  emptyLabel: string
  emptyState: TabEmptyStateConfig
  onPeopleChange?: (next: CompanyPersonSummary[]) => void
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
  onLoadingChange?: (isLoading: boolean) => void
  onDataRefresh?: () => Promise<void> | void
  runGuardedMutation?: GuardedMutationRunner
}

const COMPANY_PEOPLE_PAGE_SIZE = 20

function normalizeCompanyPerson(record: Record<string, unknown>): CompanyPersonSummary | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  if (!displayName) return null
  return {
    id,
    displayName,
    primaryEmail:
      typeof record.primaryEmail === 'string'
        ? record.primaryEmail
        : typeof record.primary_email === 'string'
          ? record.primary_email
          : null,
    primaryPhone:
      typeof record.primaryPhone === 'string'
        ? record.primaryPhone
        : typeof record.primary_phone === 'string'
          ? record.primary_phone
          : null,
    status:
      typeof record.status === 'string'
        ? record.status
        : null,
    lifecycleStage:
      typeof record.lifecycleStage === 'string'
        ? record.lifecycleStage
        : typeof record.lifecycle_stage === 'string'
          ? record.lifecycle_stage
          : null,
    jobTitle:
      typeof record.jobTitle === 'string'
        ? record.jobTitle
        : typeof record.job_title === 'string'
          ? record.job_title
          : null,
    department:
      typeof record.department === 'string'
        ? record.department
        : null,
    createdAt:
      typeof record.createdAt === 'string'
        ? record.createdAt
        : typeof record.created_at === 'string'
          ? record.created_at
          : null,
    organizationId:
      typeof record.organizationId === 'string'
        ? record.organizationId
        : typeof record.organization_id === 'string'
          ? record.organization_id
          : null,
    temperature:
      typeof record.temperature === 'string'
        ? record.temperature
        : null,
    source:
      typeof record.source === 'string'
        ? record.source
        : null,
    linkedAt:
      typeof record.linkedAt === 'string'
        ? record.linkedAt
        : typeof record.linked_at === 'string'
          ? record.linked_at
          : null,
  }
}

function mergeCompanyPeople(items: CompanyPersonSummary[]): CompanyPersonSummary[] {
  const merged = new Map<string, CompanyPersonSummary>()
  items.forEach((item) => merged.set(item.id, item))
  return Array.from(merged.values())
}

function matchesCompanyPersonSearch(person: CompanyPersonSummary, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery.length) return true
  const haystack = [
    person.displayName,
    person.jobTitle ?? '',
    person.primaryEmail ?? '',
    person.primaryPhone ?? '',
    person.department ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(normalizedQuery)
}

function sortCompanyPeople(items: CompanyPersonSummary[], sortMode: 'name-asc' | 'name-desc' | 'recent'): CompanyPersonSummary[] {
  return [...items].sort((left, right) => {
    if (sortMode === 'recent') {
      const leftTimestamp = Date.parse(left.linkedAt ?? left.createdAt ?? '') || 0
      const rightTimestamp = Date.parse(right.linkedAt ?? right.createdAt ?? '') || 0
      return rightTimestamp - leftTimestamp
    }
    const leftLabel = left.displayName.trim().toLowerCase()
    const rightLabel = right.displayName.trim().toLowerCase()
    if (sortMode === 'name-desc') return rightLabel.localeCompare(leftLabel)
    return leftLabel.localeCompare(rightLabel)
  })
}

type LinkExistingPeopleDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  translate: Translator
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  candidatePeople: CompanyPersonSummary[]
  candidateLoading: boolean
  selectedPersonIds: string[]
  onTogglePerson: (personId: string) => void
  onClearSelection: () => void
  onSelectVisible: () => void
  onClearVisible: () => void
  hasMoreCandidates: boolean
  candidateLoadingMore: boolean
  onLoadMoreCandidates: () => void
  onConfirm: () => void
  linking: boolean
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

function LinkExistingPeopleDialog({
  open,
  onOpenChange,
  translate,
  searchQuery,
  onSearchQueryChange,
  candidatePeople,
  candidateLoading,
  selectedPersonIds,
  onTogglePerson,
  onClearSelection,
  onSelectVisible,
  onClearVisible,
  hasMoreCandidates,
  candidateLoadingMore,
  onLoadMoreCandidates,
  onConfirm,
  linking,
  onKeyDown,
}: LinkExistingPeopleDialogProps) {
  const selectedCount = selectedPersonIds.length
  const selectedIds = React.useMemo(() => new Set(selectedPersonIds), [selectedPersonIds])
  const selectedVisibleCount = React.useMemo(
    () => candidatePeople.filter((person) => selectedIds.has(person.id)).length,
    [candidatePeople, selectedIds],
  )
  const selectableVisibleCount = candidatePeople.length - selectedVisibleCount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{translate('customers.companies.detail.people.linkDialog.title', 'Link existing person')}</DialogTitle>
          <DialogDescription>
            {translate(
              'customers.companies.detail.people.linkDialog.description',
              'Search for one or more existing people and attach them to this company without leaving the page.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={translate('customers.companies.detail.people.linkSearchPlaceholder', 'Search people by name or email')}
            aria-label={translate('customers.companies.detail.people.linkSearchPlaceholder', 'Search people by name or email')}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedCount > 0
                ? translate(
                    'customers.companies.detail.people.linkSelectedCount',
                    '{{count}} selected',
                    { count: String(selectedCount) },
                  )
                : translate(
                    'customers.companies.detail.people.linkSelectionHint',
                    'Choose one or more people to link.',
                  )}
            </p>
            <div className="flex items-center gap-2">
              {selectableVisibleCount > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={onSelectVisible}>
                  {translate('customers.companies.detail.people.linkSelectVisible', 'Select visible')}
                </Button>
              ) : null}
              {selectedVisibleCount > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={onClearVisible}>
                  {translate('customers.companies.detail.people.linkClearVisible', 'Clear visible')}
                </Button>
              ) : null}
              {selectedCount > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
                  {translate('customers.companies.detail.people.linkClear', 'Clear selection')}
                </Button>
              ) : null}
            </div>
          </div>
          {candidateLoading && candidatePeople.length === 0 ? (
            <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
              {translate('customers.companies.detail.people.linkLoading', 'Searching people…')}
            </div>
          ) : candidatePeople.length > 0 ? (
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {candidatePeople.map((person) => {
                const selected = selectedIds.has(person.id)
                return (
                  <label
                    key={person.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 border-b px-3 py-3 last:border-b-0',
                      selected ? 'bg-accent/50' : 'hover:bg-accent/20',
                    )}
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onTogglePerson(person.id)}
                      aria-label={translate(
                        'customers.companies.detail.people.linkSelectPerson',
                        'Select {{name}}',
                        { name: person.displayName },
                      )}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{person.displayName}</p>
                          {person.jobTitle ? (
                            <p className="truncate text-xs text-muted-foreground">{person.jobTitle}</p>
                          ) : null}
                        </div>
                        {person.status ? (
                          <Badge variant="outline" className="shrink-0 px-2 py-0 text-xs font-medium">
                            {person.status}
                          </Badge>
                        ) : null}
                      </div>
                      {person.primaryEmail || person.primaryPhone ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {person.primaryEmail ?? person.primaryPhone}
                        </p>
                      ) : null}
                    </div>
                  </label>
                )
              })}
              {hasMoreCandidates || candidateLoadingMore ? (
                <div className="border-t border-border/60 px-3 py-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={onLoadMoreCandidates}
                    disabled={candidateLoadingMore}
                  >
                    {candidateLoadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {translate('customers.companies.detail.people.linkLoadMore', 'Load more people')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
              {translate('customers.companies.detail.people.linkEmpty', 'No matching people found.')}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={linking}>
            {translate('customers.companies.detail.people.linkCancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={selectedCount === 0 || linking}>
            {linking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {translate('customers.companies.detail.people.linkSubmitting', 'Linking…')}
              </>
            ) : (
              translate('customers.companies.detail.people.linkConfirmSelected', 'Link selected')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CompanyPeopleSection({
  companyId,
  companyName,
  initialPeople,
  addActionLabel,
  emptyLabel,
  emptyState,
  onPeopleChange,
  onActionChange,
  translator,
  onLoadingChange,
  onDataRefresh,
  runGuardedMutation,
}: CompanyPeopleSectionProps) {
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const translate: Translator = translator ?? fallbackTranslator
  const [people, setPeople] = React.useState<CompanyPersonSummary[]>(initialPeople)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [selectedPersonIds, setSelectedPersonIds] = React.useState<string[]>([])
  const [linking, setLinking] = React.useState(false)
  const [candidatePeople, setCandidatePeople] = React.useState<CompanyPersonSummary[]>([])
  const [candidatePeopleLoading, setCandidatePeopleLoading] = React.useState(false)
  const [candidatePeopleLoadingMore, setCandidatePeopleLoadingMore] = React.useState(false)
  const [linkSearchQuery, setLinkSearchQuery] = React.useState('')
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sortMode, setSortMode] = React.useState<'name-asc' | 'name-desc' | 'recent'>('name-asc')
  const [filtersOpen, setFiltersOpen] = React.useState(true)
  const [visiblePeople, setVisiblePeople] = React.useState<CompanyPersonSummary[]>([])
  const [listPage, setListPage] = React.useState(1)
  const [listTotalPages, setListTotalPages] = React.useState(1)
  const [listTotalCount, setListTotalCount] = React.useState(initialPeople.length)
  const [listLoading, setListLoading] = React.useState(true)
  const [candidatePage, setCandidatePage] = React.useState(1)
  const [candidateTotalPages, setCandidateTotalPages] = React.useState(1)
  const [starredIds, setStarredIds] = React.useState<Set<string>>(
    () => new Set(readJsonFromLocalStorage<string[]>(`om:starred-people:${companyId}`, [])),
  )
  const candidatePeopleRef = React.useRef<Map<string, CompanyPersonSummary>>(new Map())
  const candidateRequestIdRef = React.useRef(0)
  const pendingPeopleChangeRef = React.useRef(false)

  const runWriteMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  const toggleStar = React.useCallback((personId: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev)
      if (next.has(personId)) next.delete(personId)
      else next.add(personId)
      writeJsonToLocalStorage(`om:starred-people:${companyId}`, [...next])
      return next
    })
  }, [companyId])

  const displayedPeople = React.useMemo(
    () => (visiblePeople.length > 0 ? visiblePeople : people),
    [people, visiblePeople],
  )
  const totalLinkedPeople = listTotalCount > 0 ? listTotalCount : displayedPeople.length
  const decisionMakerNames = React.useMemo(
    () => displayedPeople.filter((person) => starredIds.has(person.id)).map((person) => person.displayName),
    [displayedPeople, starredIds],
  )

  React.useEffect(() => {
    const action: SectionAction = {
      label: addActionLabel,
      onClick: () => {
        setCreateDialogOpen(true)
      },
    }
    onActionChange?.(action)
    return () => {
      onActionChange?.(null)
    }
  }, [addActionLabel, onActionChange])

  React.useEffect(() => {
    pendingPeopleChangeRef.current = false
    setPeople(initialPeople)
  }, [initialPeople])

  React.useEffect(() => {
    if (!pendingPeopleChangeRef.current) return
    pendingPeopleChangeRef.current = false
    onPeopleChange?.(people)
  }, [onPeopleChange, people])

  const loadVisiblePeople = React.useCallback(async () => {
    setListLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(listPage),
        pageSize: String(COMPANY_PEOPLE_PAGE_SIZE),
        sort: sortMode,
      })
      if (searchQuery.trim().length > 0) {
        params.set('search', searchQuery.trim())
      }
      const payload = await readApiResultOrThrow<{
        items?: CompanyPersonSummary[]
        page?: number
        total?: number
        totalPages?: number
      }>(
        `/api/customers/companies/${encodeURIComponent(companyId)}/people?${params.toString()}`,
        undefined,
        { errorMessage: translate('customers.companies.detail.people.loadError', 'Failed to load people.') },
      )
      const nextTotalCount = typeof payload.total === 'number' ? payload.total : 0
      setVisiblePeople(Array.isArray(payload.items) ? payload.items : [])
      setListPage(typeof payload.page === 'number' ? payload.page : listPage)
      setListTotalCount((current) => (searchQuery.trim().length > 0 ? Math.max(current, nextTotalCount) : nextTotalCount))
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
  }, [companyId, listPage, searchQuery, sortMode, translate])

  React.useEffect(() => {
    void loadVisiblePeople()
  }, [loadVisiblePeople])

  React.useEffect(() => {
    setListPage(1)
  }, [searchQuery, sortMode])

  const loadCandidatePeople = React.useCallback(
    async (query?: string, page = 1): Promise<{ items: CompanyPersonSummary[]; totalPages: number }> => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(COMPANY_PEOPLE_PAGE_SIZE),
        sortField: 'name',
        sortDir: 'asc',
        excludeLinkedCompanyId: companyId,
      })
      if (typeof query === 'string' && query.trim().length > 0) {
        params.set('search', query.trim())
      }
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/people?${params.toString()}`,
        undefined,
        { errorMessage: translate('customers.companies.detail.people.linkLoadError', 'Failed to load people.') },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const nextPeople = items
        .map((item) => (item && typeof item === 'object' ? normalizeCompanyPerson(item as Record<string, unknown>) : null))
        .filter((entry): entry is CompanyPersonSummary => entry !== null)
      nextPeople.forEach((entry) => {
        candidatePeopleRef.current.set(entry.id, entry)
      })
      return {
        items: nextPeople,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
      }
    },
    [companyId, translate],
  )

  React.useEffect(() => {
    if (!linkDialogOpen) return

    const requestId = candidateRequestIdRef.current + 1
    candidateRequestIdRef.current = requestId
    const appendRequest = candidatePage > 1
    if (appendRequest) {
      setCandidatePeopleLoadingMore(true)
    } else {
      setCandidatePeopleLoading(true)
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const nextPage = await loadCandidatePeople(linkSearchQuery, candidatePage)
          if (candidateRequestIdRef.current !== requestId) return
          setCandidatePeople((current) => {
            if (candidatePage <= 1) return nextPage.items
            const merged = new Map(current.map((entry) => [entry.id, entry]))
            nextPage.items.forEach((entry) => merged.set(entry.id, entry))
            return Array.from(merged.values())
          })
          setCandidateTotalPages(nextPage.totalPages)
          setSelectedPersonIds((current) =>
            current.filter((personId) => nextPage.items.some((entry) => entry.id === personId) || candidatePeopleRef.current.has(personId)),
          )
        } catch {
          if (candidateRequestIdRef.current !== requestId) return
          if (!appendRequest) {
            setCandidatePeople([])
            setCandidateTotalPages(1)
          }
        } finally {
          if (candidateRequestIdRef.current === requestId) {
            if (appendRequest) {
              setCandidatePeopleLoadingMore(false)
            } else {
              setCandidatePeopleLoading(false)
            }
          }
        }
      })()
    }, linkSearchQuery.trim().length > 0 ? 150 : 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [candidatePage, linkDialogOpen, linkSearchQuery, loadCandidatePeople])

  React.useEffect(() => {
    if (!linkDialogOpen) return
    setCandidatePage(1)
  }, [linkDialogOpen, linkSearchQuery])

  const resetLinkDialog = React.useCallback(() => {
    candidateRequestIdRef.current += 1
    setSelectedPersonIds([])
    setLinkSearchQuery('')
    setCandidatePeople([])
    setCandidatePeopleLoading(false)
    setCandidatePeopleLoadingMore(false)
    setCandidatePage(1)
    setCandidateTotalPages(1)
    candidatePeopleRef.current.clear()
  }, [])

  const handleLinkDialogOpenChange = React.useCallback((open: boolean) => {
    setLinkDialogOpen(open)
    if (!open) {
      resetLinkDialog()
    }
  }, [resetLinkDialog])

  const toggleSelectedPerson = React.useCallback((personId: string) => {
    setSelectedPersonIds((current) => (
      current.includes(personId)
        ? current.filter((entry) => entry !== personId)
        : [...current, personId]
    ))
  }, [])

  const clearSelectedPeople = React.useCallback(() => {
    setSelectedPersonIds([])
  }, [])

  const selectVisibleCandidatePeople = React.useCallback(() => {
    if (!candidatePeople.length) return
    setSelectedPersonIds((current) => {
      const merged = new Set(current)
      candidatePeople.forEach((person) => merged.add(person.id))
      return Array.from(merged)
    })
  }, [candidatePeople])

  const clearVisibleCandidatePeople = React.useCallback(() => {
    if (!candidatePeople.length) return
    const visibleIds = new Set(candidatePeople.map((person) => person.id))
    setSelectedPersonIds((current) => current.filter((personId) => !visibleIds.has(personId)))
  }, [candidatePeople])

  const applyPeopleChange = React.useCallback(
    (updater: (current: CompanyPersonSummary[]) => CompanyPersonSummary[]) => {
      setPeople((current) => {
        const next = updater(current)
        if (next !== current) {
          pendingPeopleChangeRef.current = true
        }
        return next
      })
    },
    [],
  )

  const handleLink = React.useCallback(async () => {
    if (!selectedPersonIds.length || linking) return

    const idsToLink = [...selectedPersonIds]
    const optimisticPeople = idsToLink
      .map((personId) => candidatePeopleRef.current.get(personId) ?? null)
      .filter((entry): entry is CompanyPersonSummary => entry !== null)
    const newLinkedCount = idsToLink.filter((personId) => !people.some((entry) => entry.id === personId)).length

    setLinking(true)
    onLoadingChange?.(true)
    try {
      for (const personId of idsToLink) {
        await runWriteMutation(
          () =>
            apiCallOrThrow(
              `/api/customers/people/${encodeURIComponent(personId)}/companies`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ companyId }),
              },
              { errorMessage: translate('customers.companies.detail.people.linkError', 'Failed to link person to company.') },
            ),
            {
              personId,
              companyId,
            },
          )
      }

      if (optimisticPeople.length > 0) {
        applyPeopleChange((current) => {
          return mergeCompanyPeople([...current, ...optimisticPeople])
        })
        if (newLinkedCount > 0) {
          setListTotalCount((current) => current + newLinkedCount)
        }
        if (listPage === 1) {
          setVisiblePeople((current) => {
            const matchingPeople = optimisticPeople.filter((entry) => matchesCompanyPersonSearch(entry, searchQuery))
            if (!matchingPeople.length) return current
            return sortCompanyPeople(
              mergeCompanyPeople([...current, ...matchingPeople]),
              sortMode,
            ).slice(0, COMPANY_PEOPLE_PAGE_SIZE)
          })
        }
      }
      await loadVisiblePeople()
      flash(
        idsToLink.length === 1
          ? translate('customers.companies.detail.people.linkSuccess', 'Person linked to company.')
          : translate(
              'customers.companies.detail.people.linkSuccessMultiple',
              '{{count}} people linked to company.',
              { count: String(idsToLink.length) },
            ),
        'success',
      )
      handleLinkDialogOpenChange(false)
    } catch (err) {
      try {
        await onDataRefresh?.()
      } catch {
        // keep the original linking error for the user
      }
      const message =
        err instanceof Error
          ? err.message
          : translate('customers.companies.detail.people.linkError', 'Failed to link person to company.')
      flash(message, 'error')
    } finally {
      setLinking(false)
      onLoadingChange?.(false)
    }
  }, [
    applyPeopleChange,
    companyId,
    handleLinkDialogOpenChange,
    linking,
    onLoadingChange,
    loadVisiblePeople,
    listPage,
    people,
    runWriteMutation,
    searchQuery,
    selectedPersonIds,
    sortMode,
    translate,
  ])

  const handleLinkDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!selectedPersonIds.length || linking) return
        void handleLink()
      }
    },
    [handleLink, linking, selectedPersonIds],
  )

  const handleRemove = React.useCallback(
    async (personId: string) => {
      if (!personId || removingId) return
      setRemovingId(personId)
      onLoadingChange?.(true)
      try {
        await runWriteMutation(
          () =>
            apiCallOrThrow(
              `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(companyId)}`,
              { method: 'DELETE' },
              { errorMessage: translate('customers.companies.detail.people.removeError', 'Failed to unlink person from company.') },
            ),
          {
            personId,
            companyId,
          },
        )
        applyPeopleChange((current) => current.filter((entry) => entry.id !== personId))
        setVisiblePeople((current) => current.filter((entry) => entry.id !== personId))
        setListTotalCount((current) => Math.max(0, current - 1))
        await loadVisiblePeople()
        flash(translate('customers.companies.detail.people.removeSuccess', 'Person unlinked from company.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : translate('customers.companies.detail.people.removeError', 'Failed to unlink person from company.')
        flash(message, 'error')
      } finally {
        setRemovingId(null)
        onLoadingChange?.(false)
      }
    },
    [applyPeopleChange, companyId, loadVisiblePeople, onLoadingChange, removingId, runWriteMutation, translate],
  )

  const linkAction = (
    <Button type="button" variant="outline" size="sm" onClick={() => handleLinkDialogOpenChange(true)} disabled={linking}>
      <Link2 className="mr-1.5 h-4 w-4" />
      {translate('customers.companies.detail.people.linkAction', 'Link existing person')}
    </Button>
  )
  const addPersonAction = (
    <Button type="button" size="sm" onClick={() => setCreateDialogOpen(true)}>
      <Plus className="mr-1.5 h-4 w-4" />
      {addActionLabel}
    </Button>
  )

  if (!listLoading && totalLinkedPeople === 0) {
    return (
      <>
        <EmptyState
          icon={<Users className="h-10 w-10 text-muted-foreground" />}
          title={emptyState.title}
          actionLabel={emptyState.actionLabel}
          onAction={() => setCreateDialogOpen(true)}
        >
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          <div className="mt-4">{linkAction}</div>
        </EmptyState>
        <LinkExistingPeopleDialog
          open={linkDialogOpen}
          onOpenChange={handleLinkDialogOpenChange}
          translate={translate}
          searchQuery={linkSearchQuery}
          onSearchQueryChange={setLinkSearchQuery}
          candidatePeople={candidatePeople}
          candidateLoading={candidatePeopleLoading || candidatePeopleLoadingMore}
          selectedPersonIds={selectedPersonIds}
          onTogglePerson={toggleSelectedPerson}
          onClearSelection={clearSelectedPeople}
          onSelectVisible={selectVisibleCandidatePeople}
          onClearVisible={clearVisibleCandidatePeople}
          hasMoreCandidates={candidatePage < candidateTotalPages}
          candidateLoadingMore={candidatePeopleLoadingMore}
          onLoadMoreCandidates={() => setCandidatePage((current) => current + 1)}
          onConfirm={() => void handleLink()}
          linking={linking}
          onKeyDown={handleLinkDialogKeyDown}
        />
        <CreatePersonDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          companyId={companyId}
          companyName={companyName ?? companyId}
          runGuardedMutation={runWriteMutation}
          onPersonCreated={() => {
            setCreateDialogOpen(false)
            onDataRefresh?.()
          }}
        />
      </>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {/* Roles section above people grid */}
        <RolesSection
          entityType="company"
          entityId={companyId}
          entityName={companyName ?? null}
        />

        <section className="rounded-[10px] border bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">
                    {translate('customers.companies.detail.people.sectionTitle', 'People')}
                  </h3>
                  <Badge variant="secondary" className="rounded-full px-2 py-0 text-xs font-semibold">
                    {totalLinkedPeople}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'customers.companies.detail.people.sectionSubtitle',
                    'Employees and decision makers on the client side',
                  )}
                </p>
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
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={translate('customers.companies.detail.people.searchPlaceholder', 'Search by name, role, email...')}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                    {translate('customers.companies.detail.people.filter', 'Filters')}
                  </Button>
                  {filtersOpen ? (
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as 'name-asc' | 'name-desc' | 'recent')}
                      className="h-10 min-w-[11rem] rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="name-asc">{translate('customers.companies.detail.people.sortNameAsc', 'Sort: Name A-Z')}</option>
                      <option value="name-desc">{translate('customers.companies.detail.people.sortNameDesc', 'Sort: Name Z-A')}</option>
                      <option value="recent">{translate('customers.companies.detail.people.sortRecent', 'Sort: Recently linked')}</option>
                    </select>
                  ) : null}
                </div>
              </div>
            ) : null}

            {listLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {translate('customers.companies.detail.people.loading', 'Loading people…')}
              </p>
            ) : visiblePeople.length > 0 ? (
              <>
                <div
                  className="grid items-start gap-4"
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 19.5rem), 1fr))' }}
                >
                  {visiblePeople.map((person) => (
                    <PersonCard
                      key={person.id}
                      person={person}
                      isStarred={starredIds.has(person.id)}
                      onToggleStar={toggleStar}
                      onUnlink={handleRemove}
                    />
                  ))}
                </div>
                {listTotalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    <span>
                      {translate('customers.companies.detail.people.pageSummary', 'Page {{page}} of {{total}}', {
                        page: listPage,
                        total: listTotalPages,
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setListPage((current) => Math.max(1, current - 1))} disabled={listPage <= 1}>
                        {translate('customers.companies.detail.people.previous', 'Previous')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setListPage((current) => Math.min(listTotalPages, current + 1))} disabled={listPage >= listTotalPages}>
                        {translate('customers.companies.detail.people.next', 'Next')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : totalLinkedPeople > 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {translate('customers.companies.detail.people.noSearchResults', 'No people match your search.')}
              </p>
            ) : null}
          </div>
        </section>

        <DecisionMakersFooter
          names={decisionMakerNames}
          onSendInvitation={() => {
            const starredEmails = displayedPeople
              .filter((person) => starredIds.has(person.id) && person.primaryEmail)
              .map((person) => person.primaryEmail!)
            if (starredEmails.length > 0) {
              window.open(`mailto:${starredEmails.join(',')}`, '_blank')
            }
          }}
        />
      </div>
      <LinkExistingPeopleDialog
        open={linkDialogOpen}
        onOpenChange={handleLinkDialogOpenChange}
        translate={translate}
        searchQuery={linkSearchQuery}
        onSearchQueryChange={setLinkSearchQuery}
        candidatePeople={candidatePeople}
        candidateLoading={candidatePeopleLoading || candidatePeopleLoadingMore}
        selectedPersonIds={selectedPersonIds}
        onTogglePerson={toggleSelectedPerson}
        onClearSelection={clearSelectedPeople}
        onSelectVisible={selectVisibleCandidatePeople}
        onClearVisible={clearVisibleCandidatePeople}
        hasMoreCandidates={candidatePage < candidateTotalPages}
        candidateLoadingMore={candidatePeopleLoadingMore}
        onLoadMoreCandidates={() => setCandidatePage((current) => current + 1)}
        onConfirm={() => void handleLink()}
        linking={linking}
        onKeyDown={handleLinkDialogKeyDown}
      />

      <CreatePersonDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        companyId={companyId}
        companyName={companyName ?? companyId}
        runGuardedMutation={runWriteMutation}
        onPersonCreated={() => {
          setCreateDialogOpen(false)
          void loadVisiblePeople()
          void onDataRefresh?.()
        }}
      />
    </>
  )
}

export default CompanyPeopleSection
