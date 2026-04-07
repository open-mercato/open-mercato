"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
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
}

export type CompanyPeopleSectionProps = {
  companyId: string
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

function buildCompanyPersonCreateHref(companyId: string): string {
  const returnTo = `/backend/customers/companies-v2/${encodeURIComponent(companyId)}?tab=people`
  return `/backend/customers/people/create?companyId=${encodeURIComponent(companyId)}&returnTo=${encodeURIComponent(returnTo)}`
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
  const router = useRouter()
  const tHook = useT()
  const fallbackTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const translate: Translator = translator ?? fallbackTranslator
  const [people, setPeople] = React.useState<CompanyPersonSummary[]>(initialPeople)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(null)
  const [linking, setLinking] = React.useState(false)
  const candidatePeopleRef = React.useRef<Map<string, CompanyPersonSummary>>(new Map())
  const pendingPeopleChangeRef = React.useRef(false)
  const createPersonHref = React.useMemo(() => buildCompanyPersonCreateHref(companyId), [companyId])

  const runWriteMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  React.useEffect(() => {
    const action: SectionAction = {
      label: addActionLabel,
      onClick: () => {
        router.push(createPersonHref)
      },
    }
    onActionChange?.(action)
    return () => {
      onActionChange?.(null)
    }
  }, [addActionLabel, createPersonHref, onActionChange, router])

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
            '/api/customers/people',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: selectedPersonId, companyEntityId: companyId }),
            },
            { errorMessage: translate('customers.companies.detail.people.linkError', 'Failed to link person to company.') },
          ),
        {
          id: selectedPersonId,
          companyEntityId: companyId,
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
              '/api/customers/people',
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: personId, companyEntityId: null }),
              },
              { errorMessage: translate('customers.companies.detail.people.removeError', 'Failed to unlink person from company.') },
            ),
          {
            id: personId,
            companyEntityId: null,
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
    <Button type="button" size="sm" onClick={() => router.push(createPersonHref)}>
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
          onAction={() => router.push(createPersonHref)}
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
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap justify-end gap-2">
          {linkAction}
        </div>
        <div className="rounded border bg-muted/20">
          {people.map((person) => (
            <div
              key={person.id}
              className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{person.displayName}</p>
                  {person.jobTitle ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {person.jobTitle}
                    </span>
                  ) : null}
                  {person.status ? (
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {person.status}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {person.primaryEmail ? <span>{person.primaryEmail}</span> : null}
                  {person.primaryPhone ? <span>{person.primaryPhone}</span> : null}
                  {person.lifecycleStage ? <span>{person.lifecycleStage}</span> : null}
                  {(() => {
                    const linkedDate = formatDate(person.createdAt ?? null)
                    return linkedDate
                      ? (
                        <span>
                          {translate('customers.companies.detail.people.linkedOn', 'Linked on {{date}}', {
                            date: linkedDate,
                          })}
                        </span>
                      )
                      : null
                  })()}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/backend/customers/people-v2/${encodeURIComponent(person.id)}`)}
                >
                  <ArrowUpRightSquare className="mr-1.5 h-4 w-4" />
                  {translate('customers.companies.detail.people.open', 'Open person')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(person.id)}
                  disabled={removingId === person.id}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {removingId === person.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {translate('customers.companies.detail.people.remove', 'Unlink')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'customers.companies.detail.people.helper',
            'People linked to this company appear here and can be created, linked, opened, or unlinked without leaving the page.',
          )}
        </p>
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
    </>
  )
}

export default CompanyPeopleSection
