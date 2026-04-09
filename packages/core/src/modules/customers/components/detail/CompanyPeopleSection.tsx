"use client"

import * as React from 'react'
import { Users, Trash2, Loader2, ArrowUpRightSquare, Link2, Plus } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { SectionAction, TabEmptyStateConfig, Translator } from './types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { formatDate } from './utils'
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
  }
}

function toLookupItem(person: CompanyPersonSummary): LookupSelectItem {
  const subtitle = person.primaryEmail || person.primaryPhone || null
  const description = person.lifecycleStage || person.jobTitle || null
  return {
    id: person.id,
    title: person.displayName,
    subtitle,
    description,
    rightLabel: person.status || null,
  }
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
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(null)
  const [linking, setLinking] = React.useState(false)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sortMode, setSortMode] = React.useState<'name-asc' | 'name-desc' | 'recent'>('name-asc')
  const [starredIds, setStarredIds] = React.useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`om:starred-people:${companyId}`)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })
  const candidatePeopleRef = React.useRef<Map<string, CompanyPersonSummary>>(new Map())
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
      try { localStorage.setItem(`om:starred-people:${companyId}`, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [companyId])

  const filteredAndSorted = React.useMemo(() => {
    let result = [...people]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((p) =>
        p.displayName.toLowerCase().includes(q) ||
        (p.primaryEmail?.toLowerCase().includes(q)) ||
        (p.jobTitle?.toLowerCase().includes(q)),
      )
    }
    if (sortMode === 'name-asc') result.sort((a, b) => a.displayName.localeCompare(b.displayName))
    else if (sortMode === 'name-desc') result.sort((a, b) => b.displayName.localeCompare(a.displayName))
    else result.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return db - da
    })
    return result
  }, [people, searchQuery, sortMode])

  const decisionMakerNames = React.useMemo(
    () => people.filter((p) => starredIds.has(p.id)).map((p) => p.displayName),
    [people, starredIds],
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

  const linkedIds = React.useMemo(() => new Set(people.map((person) => person.id)), [people])

  const fetchCandidatePeople = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const params = new URLSearchParams({
        pageSize: '20',
        sortField: 'name',
        sortDir: 'asc',
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
      const nextMap = new Map<string, CompanyPersonSummary>()
      const options = items
        .map((item) => (item && typeof item === 'object' ? normalizeCompanyPerson(item as Record<string, unknown>) : null))
        .filter((entry): entry is CompanyPersonSummary => entry !== null)
        .filter((entry) => !linkedIds.has(entry.id))
        .map((entry) => {
          nextMap.set(entry.id, entry)
          return toLookupItem(entry)
        })
      candidatePeopleRef.current = nextMap
      return options
    },
    [linkedIds, translate],
  )

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
    if (!selectedPersonId || linking) return
    setLinking(true)
    onLoadingChange?.(true)
    try {
      await runWriteMutation(
        () =>
          apiCallOrThrow(
            `/api/customers/people/${encodeURIComponent(selectedPersonId)}/companies`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ companyId }),
            },
            { errorMessage: translate('customers.companies.detail.people.linkError', 'Failed to link person to company.') },
          ),
          {
            personId: selectedPersonId,
            companyId,
          },
        )

      const candidate = candidatePeopleRef.current.get(selectedPersonId)
      if (candidate) {
        applyPeopleChange((current) => {
          const withoutSelected = current.filter((entry) => entry.id !== selectedPersonId)
          return [...withoutSelected, candidate]
        })
      }

      flash(translate('customers.companies.detail.people.linkSuccess', 'Person linked to company.'), 'success')
      setSelectedPersonId(null)
      setLinkDialogOpen(false)
      await onDataRefresh?.()
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : translate('customers.companies.detail.people.linkError', 'Failed to link person to company.')
      flash(message, 'error')
    } finally {
      setLinking(false)
      onLoadingChange?.(false)
    }
  }, [applyPeopleChange, companyId, linking, onDataRefresh, onLoadingChange, runWriteMutation, selectedPersonId, translate])

  const handleLinkDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!selectedPersonId || linking) return
        void handleLink()
      }
    },
    [handleLink, linking, selectedPersonId],
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
        flash(translate('customers.companies.detail.people.removeSuccess', 'Person unlinked from company.'), 'success')
        await onDataRefresh?.()
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
    [applyPeopleChange, onDataRefresh, onLoadingChange, removingId, runWriteMutation, translate],
  )

  const linkAction = (
    <Button type="button" variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)} disabled={linking}>
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

  if (!people.length) {
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
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent className="sm:max-w-2xl" onKeyDown={handleLinkDialogKeyDown}>
            <DialogHeader>
              <DialogTitle>{translate('customers.companies.detail.people.linkDialog.title', 'Link existing person')}</DialogTitle>
              <DialogDescription>
                {translate(
                  'customers.companies.detail.people.linkDialog.description',
                  'Search for an existing person and attach them to this company without leaving the page.',
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <LookupSelect
                value={selectedPersonId}
                onChange={setSelectedPersonId}
                fetchOptions={fetchCandidatePeople}
                defaultOpen
                searchPlaceholder={translate('customers.companies.detail.people.linkSearchPlaceholder', 'Search people by name or email')}
                emptyLabel={translate('customers.companies.detail.people.linkEmpty', 'No matching people found.')}
                loadingLabel={translate('customers.companies.detail.people.linkLoading', 'Searching people…')}
                selectLabel={translate('customers.companies.detail.people.linkSelect', 'Link')}
                selectedLabel={translate('customers.companies.detail.people.linkSelected', 'Selected')}
                clearLabel={translate('customers.companies.detail.people.linkClear', 'Clear selection')}
                startTypingLabel={translate('customers.companies.detail.people.linkStartTyping', 'Start typing to search for an existing person.')}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)} disabled={linking}>
                {translate('customers.companies.detail.people.linkCancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void handleLink()} disabled={!selectedPersonId || linking}>
                {linking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {translate('customers.companies.detail.people.linkSubmitting', 'Linking…')}
                  </>
                ) : (
                  translate('customers.companies.detail.people.linkConfirm', 'Link person')
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
        <RolesSection entityType="company" entityId={companyId} />

        {/* Section header with title + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {translate('customers.companies.detail.people.sectionTitle', 'People')}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{people.length}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              {translate('customers.companies.detail.people.sectionSubtitle', 'Team members and contacts at this company')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {linkAction}
            {addPersonAction}
          </div>
        </div>

        {/* Search + Sort bar */}
        {people.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={translate('customers.companies.detail.people.searchPlaceholder', 'Search by name, role, email...')}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as 'name-asc' | 'name-desc' | 'recent')}
              className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="name-asc">{translate('customers.companies.detail.people.sortNameAsc', 'Sort: Name A-Z')}</option>
              <option value="name-desc">{translate('customers.companies.detail.people.sortNameDesc', 'Sort: Name Z-A')}</option>
              <option value="recent">{translate('customers.companies.detail.people.sortRecent', 'Sort: Recently linked')}</option>
            </select>
          </div>
        )}

        {/* People grid (card layout) */}
        {filteredAndSorted.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAndSorted.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                isStarred={starredIds.has(person.id)}
                onToggleStar={toggleStar}
                onUnlink={handleRemove}
              />
            ))}
          </div>
        ) : people.length > 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {translate('customers.companies.detail.people.noSearchResults', 'No people match your search.')}
          </p>
        ) : null}

        {/* Decision makers footer */}
        <DecisionMakersFooter
          names={decisionMakerNames}
          onSendInvitation={() => {
            const starredEmails = people
              .filter((p) => starredIds.has(p.id) && p.primaryEmail)
              .map((p) => p.primaryEmail!)
            if (starredEmails.length > 0) {
              window.open(`mailto:${starredEmails.join(',')}`, '_blank')
            }
          }}
        />
      </div>
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-2xl" onKeyDown={handleLinkDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{translate('customers.companies.detail.people.linkDialog.title', 'Link existing person')}</DialogTitle>
            <DialogDescription>
              {translate(
                'customers.companies.detail.people.linkDialog.description',
                'Search for an existing person and attach them to this company without leaving the page.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <LookupSelect
              value={selectedPersonId}
              onChange={setSelectedPersonId}
              fetchOptions={fetchCandidatePeople}
              defaultOpen
              searchPlaceholder={translate('customers.companies.detail.people.linkSearchPlaceholder', 'Search people by name or email')}
              emptyLabel={translate('customers.companies.detail.people.linkEmpty', 'No matching people found.')}
              loadingLabel={translate('customers.companies.detail.people.linkLoading', 'Searching people…')}
              selectLabel={translate('customers.companies.detail.people.linkSelect', 'Link')}
              selectedLabel={translate('customers.companies.detail.people.linkSelected', 'Selected')}
              clearLabel={translate('customers.companies.detail.people.linkClear', 'Clear selection')}
              startTypingLabel={translate('customers.companies.detail.people.linkStartTyping', 'Start typing to search for an existing person.')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)} disabled={linking}>
              {translate('customers.companies.detail.people.linkCancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleLink()} disabled={!selectedPersonId || linking}>
              {linking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {translate('customers.companies.detail.people.linkSubmitting', 'Linking…')}
                </>
              ) : (
                translate('customers.companies.detail.people.linkConfirm', 'Link person')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

export default CompanyPeopleSection
