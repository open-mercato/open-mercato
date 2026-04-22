"use client"

import * as React from 'react'
import { Users, Link2, Plus, Filter } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { SectionAction, TabEmptyStateConfig, Translator } from './types'
import { CreatePersonDialog } from './CreatePersonDialog'
import { PersonCard } from './PersonCard'
import { DecisionMakersFooter } from './DecisionMakersFooter'
import { RolesSection } from './RolesSection'
import { LinkEntityDialog, type LinkEntityOption } from '../linking/LinkEntityDialog'
import { createPersonLinkAdapter } from '../linking/adapters/personAdapter'

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

function sortCompanyPeople(
  items: CompanyPersonSummary[],
  sortMode: 'name-asc' | 'name-desc' | 'recent',
): CompanyPersonSummary[] {
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
  const fallbackTranslator = React.useMemo<Translator>(
    () => createTranslatorWithFallback(tHook),
    [tHook],
  )
  const translate: Translator = translator ?? fallbackTranslator
  const [people, setPeople] = React.useState<CompanyPersonSummary[]>(initialPeople)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sortMode, setSortMode] = React.useState<'name-asc' | 'name-desc' | 'recent'>('name-asc')
  const [filtersOpen, setFiltersOpen] = React.useState(true)
  const [visiblePeople, setVisiblePeople] = React.useState<CompanyPersonSummary[]>([])
  const [listPage, setListPage] = React.useState(1)
  const [listTotalPages, setListTotalPages] = React.useState(1)
  const [listTotalCount, setListTotalCount] = React.useState(initialPeople.length)
  const [listLoading, setListLoading] = React.useState(true)
  const [starredIds, setStarredIds] = React.useState<Set<string>>(
    () => new Set(readJsonFromLocalStorage<string[]>(`om:starred-people:${companyId}`, [])),
  )
  const pendingPeopleChangeRef = React.useRef(false)

  const runWriteMutation = React.useCallback(
    async <T,>(
      operation: () => Promise<T>,
      mutationPayload?: Record<string, unknown>,
    ): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  const toggleStar = React.useCallback(
    (personId: string) => {
      setStarredIds((prev) => {
        const next = new Set(prev)
        if (next.has(personId)) next.delete(personId)
        else next.add(personId)
        writeJsonToLocalStorage(`om:starred-people:${companyId}`, [...next])
        return next
      })
    },
    [companyId],
  )

  const displayedPeople = React.useMemo(
    () => (visiblePeople.length > 0 ? visiblePeople : people),
    [people, visiblePeople],
  )
  const totalLinkedPeople = listTotalCount > 0 ? listTotalCount : displayedPeople.length
  const decisionMakerNames = React.useMemo(
    () =>
      displayedPeople
        .filter((person) => starredIds.has(person.id))
        .map((person) => person.displayName),
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
        {
          errorMessage: translate(
            'customers.companies.detail.people.loadError',
            'Failed to load people.',
          ),
        },
      )
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
  }, [companyId, listPage, searchQuery, sortMode, translate])

  React.useEffect(() => {
    void loadVisiblePeople()
  }, [loadVisiblePeople])

  React.useEffect(() => {
    setListPage(1)
  }, [searchQuery, sortMode])

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

  const handleLinkConfirm = React.useCallback(
    async ({
      addedIds,
      optionsById,
    }: {
      addedIds: string[]
      removedIds: string[]
      optionsById: Record<string, LinkEntityOption>
    }) => {
      if (!addedIds.length) return
      onLoadingChange?.(true)
      try {
        for (const personId of addedIds) {
          await runWriteMutation(
            () =>
              apiCallOrThrow(
                `/api/customers/people/${encodeURIComponent(personId)}/companies`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ companyId }),
                },
                {
                  errorMessage: translate(
                    'customers.companies.detail.people.linkError',
                    'Failed to link person to company.',
                  ),
                },
              ),
            {
              personId,
              companyId,
            },
          )
        }
        const optimisticPeople: CompanyPersonSummary[] = addedIds
          .map((personId): CompanyPersonSummary | null => {
            const option = optionsById[personId]
            if (!option) return null
            return {
              id: option.id,
              displayName: option.label,
              primaryEmail: null,
              primaryPhone: null,
              jobTitle: option.subtitle ?? null,
            }
          })
          .filter((entry): entry is CompanyPersonSummary => entry !== null)
        if (optimisticPeople.length > 0) {
          applyPeopleChange((current) => mergeCompanyPeople([...current, ...optimisticPeople]))
          setListTotalCount((current) => current + optimisticPeople.length)
        }
        await loadVisiblePeople()
        flash(
          addedIds.length === 1
            ? translate(
                'customers.companies.detail.people.linkSuccess',
                'Person linked to company.',
              )
            : translate(
                'customers.companies.detail.people.linkSuccessMultiple',
                '{{count}} people linked to company.',
                { count: String(addedIds.length) },
              ),
          'success',
        )
      } catch (err) {
        try {
          await onDataRefresh?.()
        } catch {
          // preserve original linking error for the user
        }
        const message =
          err instanceof Error
            ? err.message
            : translate(
                'customers.companies.detail.people.linkError',
                'Failed to link person to company.',
              )
        flash(message, 'error')
        throw err
      } finally {
        onLoadingChange?.(false)
      }
    },
    [
      applyPeopleChange,
      companyId,
      loadVisiblePeople,
      onDataRefresh,
      onLoadingChange,
      runWriteMutation,
      translate,
    ],
  )

  const personLinkAdapter = React.useMemo(
    () =>
      createPersonLinkAdapter({
        dialogTitle: translate('customers.linking.person.dialogTitle', 'Link person'),
        dialogSubtitle: companyName
          ? translate(
              'customers.linking.person.dialogSubtitleFor',
              'Link an existing contact to {{name}}',
              { name: companyName },
            )
          : translate(
              'customers.linking.person.dialogSubtitle',
              'Link an existing contact to this company',
            ),
        sectionLabel: translate('customers.linking.person.sectionLabel', 'MATCHING CONTACTS'),
        searchPlaceholder: translate(
          'customers.linking.person.searchPlaceholder',
          'Search all people…',
        ),
        searchEmptyHint: translate(
          'customers.linking.person.searchEmpty',
          'No matching people found.',
        ),
        selectedEmptyHint: translate(
          'customers.linking.person.selectedEmpty',
          'No people selected.',
        ),
        confirmButtonLabel: translate('customers.linking.person.confirmButton', 'Link person'),
        showLinkSettings: true,
        roleOptions: [
          { id: 'decision_maker', label: 'Decision maker' },
          { id: 'budget_holder', label: 'Budget holder' },
          { id: 'stakeholder', label: 'Stakeholder' },
          { id: 'contact', label: 'Contact' },
        ],
        excludeLinkedCompanyId: companyId,
        addNew: {
          title: translate('customers.linking.person.addNew', 'Add new contact'),
          subtitle: translate(
            'customers.linking.person.addNewSubtitle',
            'Company will be filled in automatically',
          ),
          render: ({ onCancel }) => (
            <CreatePersonDialog
              open
              onClose={onCancel}
              companyId={companyId}
              companyName={companyName ?? companyId}
              runGuardedMutation={runWriteMutation}
              onPersonCreated={() => {
                // CreatePersonDialog already created and linked the person to this company
                // via the companyEntityId payload field. Refresh the on-page list and close
                // both the nested and outer dialogs so the user can see the new entry.
                void loadVisiblePeople()
                void onDataRefresh?.()
                setLinkDialogOpen(false)
                onCancel()
              }}
            />
          ),
        },
      }),
    [companyId, companyName, loadVisiblePeople, onDataRefresh, runWriteMutation, translate],
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
              {
                errorMessage: translate(
                  'customers.companies.detail.people.removeError',
                  'Failed to unlink person from company.',
                ),
              },
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
        flash(
          translate(
            'customers.companies.detail.people.removeSuccess',
            'Person unlinked from company.',
          ),
          'success',
        )
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : translate(
                'customers.companies.detail.people.removeError',
                'Failed to unlink person from company.',
              )
        flash(message, 'error')
      } finally {
        setRemovingId(null)
        onLoadingChange?.(false)
      }
    },
    [
      applyPeopleChange,
      companyId,
      loadVisiblePeople,
      onLoadingChange,
      removingId,
      runWriteMutation,
      translate,
    ],
  )

  const linkAction = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setLinkDialogOpen(true)}
    >
      <Link2 className="mr-1.5 h-4 w-4" />
      {translate(
        'customers.companies.detail.people.linkAction',
        'Link existing person',
      )}
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
        <LinkEntityDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          adapter={personLinkAdapter}
          initialSelectedIds={[]}
          onConfirm={handleLinkConfirm}
          runGuardedMutation={runWriteMutation}
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

  return (
    <>
      <div className="space-y-4">
        <RolesSection
          entityType="company"
          entityId={companyId}
          entityName={companyName ?? null}
        />

        <section className="rounded-lg border bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">
                    {translate(
                      'customers.companies.detail.people.sectionTitle',
                      'People',
                    )}
                  </h3>
                  <Badge
                    variant="secondary"
                    className="rounded-full px-2 py-0 text-xs font-semibold"
                  >
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
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={translate(
                        'customers.companies.detail.people.searchPlaceholder',
                        'Search by name, role, email...',
                      )}
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
                    {translate(
                      'customers.companies.detail.people.filter',
                      'Filters',
                    )}
                  </Button>
                  {filtersOpen ? (
                    <select
                      value={sortMode}
                      onChange={(event) =>
                        setSortMode(event.target.value as 'name-asc' | 'name-desc' | 'recent')
                      }
                      className="h-10 min-w-[11rem] rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="name-asc">
                        {translate(
                          'customers.companies.detail.people.sortNameAsc',
                          'Sort: Name A-Z',
                        )}
                      </option>
                      <option value="name-desc">
                        {translate(
                          'customers.companies.detail.people.sortNameDesc',
                          'Sort: Name Z-A',
                        )}
                      </option>
                      <option value="recent">
                        {translate(
                          'customers.companies.detail.people.sortRecent',
                          'Sort: Recently linked',
                        )}
                      </option>
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
                    />
                  ))}
                </div>
                {listTotalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    <span>
                      {translate(
                        'customers.companies.detail.people.pageSummary',
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
                        {translate('customers.companies.detail.people.previous', 'Previous')}
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
                        {translate('customers.companies.detail.people.next', 'Next')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : totalLinkedPeople > 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {translate(
                  'customers.companies.detail.people.noSearchResults',
                  'No people match your search.',
                )}
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

      <LinkEntityDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        adapter={personLinkAdapter}
        initialSelectedIds={[]}
        onConfirm={handleLinkConfirm}
        runGuardedMutation={runWriteMutation}
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

export { mergeCompanyPeople, matchesCompanyPersonSearch, sortCompanyPeople, normalizeCompanyPerson }
