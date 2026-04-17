'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, Link2, Loader2, Search, Star, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { CompanyCard, type EnrichedCompanyData } from './CompanyCard'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type LinkedCompanySummary = {
  id: string
  displayName: string
  isPrimary: boolean
}

type CompanyLookupOption = {
  id: string
  label: string
  subtitle?: string | null
}

type PersonCompaniesSectionProps = {
  personId: string
  personName: string
  initialLinkedCompanies?: LinkedCompanySummary[]
  onChanged?: () => Promise<void> | void
  runGuardedMutation?: GuardedMutationRunner
}

const LINKED_PAGE_SIZE = 20
const SELECTED_PAGE_SIZE = 15

function normalizeCompanyOptionRecord(record: Record<string, unknown>): CompanyLookupOption | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  const domain =
    typeof record.domain === 'string' && record.domain.trim().length
      ? record.domain.trim()
      : typeof record.websiteUrl === 'string' && record.websiteUrl.trim().length
        ? record.websiteUrl.trim()
        : typeof record.website_url === 'string' && record.website_url.trim().length
          ? record.website_url.trim()
          : typeof record.primaryEmail === 'string' && record.primaryEmail.trim().length
            ? record.primaryEmail.trim()
            : typeof record.primary_email === 'string' && record.primary_email.trim().length
              ? record.primary_email.trim()
              : null
  const label = displayName ?? domain ?? id
  const subtitle = domain && domain !== label ? domain : null
  return { id, label, subtitle }
}

function mergeLookupOptions(items: CompanyLookupOption[]): CompanyLookupOption[] {
  const merged = new Map<string, CompanyLookupOption>()
  items.forEach((item) => merged.set(item.id, item))
  return Array.from(merged.values())
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

function buildLinkedSummary(
  ids: string[],
  primaryId: string | null,
  optionCache: Map<string, CompanyLookupOption>,
  currentLinked: LinkedCompanySummary[],
): LinkedCompanySummary[] {
  const currentById = new Map(currentLinked.map((entry) => [entry.id, entry]))
  return ids.map((id) => {
    const cached = optionCache.get(id)
    const current = currentById.get(id)
    return {
      id,
      displayName: cached?.label ?? current?.displayName ?? id,
      isPrimary: primaryId === id,
    }
  })
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-border/60 pt-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next
          <ArrowRight className="ml-1.5 size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function PersonCompaniesSection({
  personId,
  personName,
  initialLinkedCompanies = [],
  onChanged,
  runGuardedMutation,
}: PersonCompaniesSectionProps) {
  const t = useT()
  const [items, setItems] = React.useState<EnrichedCompanyData[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<'name-asc' | 'name-desc' | 'recent'>('name-asc')
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [linkedCompanies, setLinkedCompanies] = React.useState<LinkedCompanySummary[]>(initialLinkedCompanies)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogQuery, setDialogQuery] = React.useState('')
  const [candidatePage, setCandidatePage] = React.useState(1)
  const [candidateTotalPages, setCandidateTotalPages] = React.useState(1)
  const [candidateLoading, setCandidateLoading] = React.useState(false)
  const [candidateLoadingMore, setCandidateLoadingMore] = React.useState(false)
  const [candidateCompanies, setCandidateCompanies] = React.useState<CompanyLookupOption[]>([])
  const [draftIds, setDraftIds] = React.useState<string[]>(initialLinkedCompanies.map((entry) => entry.id))
  const [draftPrimaryId, setDraftPrimaryId] = React.useState<string | null>(
    initialLinkedCompanies.find((entry) => entry.isPrimary)?.id ?? initialLinkedCompanies[0]?.id ?? null,
  )
  const [draftSaving, setDraftSaving] = React.useState(false)
  const [selectedPage, setSelectedPage] = React.useState(1)
  const [dialogCache, setDialogCache] = React.useState<Map<string, CompanyLookupOption>>(() => new Map())
  const candidateRequestIdRef = React.useRef(0)

  const { data: statusDict } = useCustomerDictionary('statuses')
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages')
  const { data: temperatureDict } = useCustomerDictionary('temperature')
  const { data: renewalQuarterDict } = useCustomerDictionary('renewal-quarters')
  const { data: roleDict } = useCustomerDictionary('person-company-roles')

  React.useEffect(() => {
    setLinkedCompanies(initialLinkedCompanies)
  }, [initialLinkedCompanies])

  React.useEffect(() => {
    setDraftIds(initialLinkedCompanies.map((entry) => entry.id))
    setDraftPrimaryId(initialLinkedCompanies.find((entry) => entry.isPrimary)?.id ?? initialLinkedCompanies[0]?.id ?? null)
  }, [initialLinkedCompanies])

  React.useEffect(() => {
    if (dialogOpen) return
    setDraftIds(linkedCompanies.map((entry) => entry.id))
    setDraftPrimaryId(linkedCompanies.find((entry) => entry.isPrimary)?.id ?? linkedCompanies[0]?.id ?? null)
  }, [dialogOpen, linkedCompanies])

  const runWriteMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  const loadData = React.useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true
    if (showLoading) setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(LINKED_PAGE_SIZE),
        sort,
      })
      if (search.trim().length > 0) {
        params.set('search', search.trim())
      }
      const payload = await readApiResultOrThrow<{
        items?: EnrichedCompanyData[]
        totalPages?: number
      }>(
        `/api/customers/people/${encodeURIComponent(personId)}/companies/enriched?${params.toString()}`,
        { cache: 'no-store' },
      )
      const nextItems = Array.isArray(payload?.items) ? payload.items : []
      setItems(nextItems)
      setTotalPages(typeof payload?.totalPages === 'number' ? payload.totalPages : 1)
      setDialogCache((prev) => {
        const next = new Map(prev)
        nextItems.forEach((item) => {
          next.set(item.companyId, {
            id: item.companyId,
            label: item.displayName,
            subtitle: item.subtitle,
          })
        })
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('customers.people.detail.companies.loadError', 'Failed to load companies.')
      flash(message, 'error')
      setItems([])
      setTotalPages(1)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [page, personId, search, sort, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  React.useEffect(() => {
    setPage(1)
  }, [search, sort])

  React.useEffect(() => {
    setDialogCache((prev) => {
      const next = new Map(prev)
      linkedCompanies.forEach((entry) => {
        next.set(entry.id, { id: entry.id, label: entry.displayName, subtitle: null })
      })
      return next
    })
  }, [linkedCompanies])

  const fetchCompaniesByIds = React.useCallback(async (ids: string[]): Promise<CompanyLookupOption[]> => {
    const uniqueIds = Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)))
    if (!uniqueIds.length) return []
    try {
      const params = new URLSearchParams({
        ids: uniqueIds.join(','),
        pageSize: String(Math.max(uniqueIds.length, 1)),
      })
      const payload = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
        `/api/customers/companies?${params.toString()}`,
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const byId = new Map<string, CompanyLookupOption>()
      items.forEach((record) => {
        if (!record || typeof record !== 'object') return
        const option = normalizeCompanyOptionRecord(record)
        if (option) byId.set(option.id, option)
      })
      return uniqueIds.map((id) => byId.get(id) ?? { id, label: id, subtitle: null })
    } catch {
      return uniqueIds.map((id) => ({ id, label: id, subtitle: null }))
    }
  }, [])

  React.useEffect(() => {
    if (!dialogOpen) return
    const visibleMissingIds = draftIds.filter((id) => !dialogCache.has(id))
    if (!visibleMissingIds.length) return
    let cancelled = false
    void fetchCompaniesByIds(visibleMissingIds).then((entries) => {
      if (cancelled) return
      setDialogCache((prev) => {
        const next = new Map(prev)
        entries.forEach((entry) => next.set(entry.id, entry))
        return next
      })
    }).catch((err) => console.warn('[PersonCompaniesSection] fetchCompaniesByIds failed', err))
    return () => {
      cancelled = true
    }
  }, [dialogCache, dialogOpen, draftIds, fetchCompaniesByIds])

  const loadCandidateCompanies = React.useCallback(
    async (query: string, nextPage: number): Promise<{ items: CompanyLookupOption[]; totalPages: number }> => {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(LINKED_PAGE_SIZE),
        sortField: 'name',
        sortDir: 'asc',
        excludeLinkedPersonId: personId,
      })
      if (query.trim().length > 0) {
        params.set('search', query.trim())
      }
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/companies?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.people.detail.companies.linkLoadError', 'Failed to load companies.') },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const nextItems = items
        .map((item) => (item && typeof item === 'object' ? normalizeCompanyOptionRecord(item as Record<string, unknown>) : null))
        .filter((entry): entry is CompanyLookupOption => entry !== null)
      return {
        items: nextItems,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
      }
    },
    [personId, t],
  )

  React.useEffect(() => {
    if (!dialogOpen) return

    const requestId = candidateRequestIdRef.current + 1
    candidateRequestIdRef.current = requestId
    const appendRequest = candidatePage > 1
    if (appendRequest) {
      setCandidateLoadingMore(true)
    } else {
      setCandidateLoading(true)
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await loadCandidateCompanies(dialogQuery, candidatePage)
          if (candidateRequestIdRef.current !== requestId) return
          setCandidateCompanies((current) => {
            if (candidatePage <= 1) return result.items
            return mergeLookupOptions([...current, ...result.items])
          })
          setCandidateTotalPages(result.totalPages)
          setDialogCache((prev) => {
            const next = new Map(prev)
            result.items.forEach((item) => next.set(item.id, item))
            return next
          })
        } catch {
          if (candidateRequestIdRef.current !== requestId) return
          if (!appendRequest) {
            setCandidateCompanies([])
            setCandidateTotalPages(1)
          }
        } finally {
          if (candidateRequestIdRef.current === requestId) {
            if (appendRequest) {
              setCandidateLoadingMore(false)
            } else {
              setCandidateLoading(false)
            }
          }
        }
      })()
    }, dialogQuery.trim().length > 0 ? 150 : 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [candidatePage, dialogOpen, dialogQuery, loadCandidateCompanies])

  React.useEffect(() => {
    if (!dialogOpen) return
    setCandidatePage(1)
  }, [dialogOpen, dialogQuery])

  const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    setDialogOpen(nextOpen)
    if (!nextOpen) {
      setDialogQuery('')
      setCandidatePage(1)
      setCandidateTotalPages(1)
      setCandidateCompanies([])
      setCandidateLoading(false)
      setCandidateLoadingMore(false)
      setDraftIds(linkedCompanies.map((entry) => entry.id))
      setDraftPrimaryId(linkedCompanies.find((entry) => entry.isPrimary)?.id ?? linkedCompanies[0]?.id ?? null)
      setSelectedPage(1)
    }
  }, [linkedCompanies])

  const selectedSet = React.useMemo(() => new Set(draftIds), [draftIds])
  const selectedVisibleCount = React.useMemo(
    () => candidateCompanies.filter((company) => selectedSet.has(company.id)).length,
    [candidateCompanies, selectedSet],
  )
  const selectableVisibleCount = candidateCompanies.length - selectedVisibleCount

  const selectedOptions = React.useMemo(
    () => draftIds.map((id) => dialogCache.get(id) ?? { id, label: id, subtitle: null }),
    [dialogCache, draftIds],
  )
  const selectedTotalPages = Math.max(1, Math.ceil(selectedOptions.length / SELECTED_PAGE_SIZE))
  const currentSelectedPage = Math.min(selectedPage, selectedTotalPages)
  const pagedSelectedOptions = React.useMemo(
    () =>
      selectedOptions.slice(
        (currentSelectedPage - 1) * SELECTED_PAGE_SIZE,
        currentSelectedPage * SELECTED_PAGE_SIZE,
      ),
    [currentSelectedPage, selectedOptions],
  )

  const selectVisibleCandidates = React.useCallback(() => {
    if (!candidateCompanies.length) return
    setDraftIds((current) => {
      const merged = new Set(current)
      candidateCompanies.forEach((company) => merged.add(company.id))
      return Array.from(merged)
    })
    setDraftPrimaryId((current) => current ?? candidateCompanies[0]?.id ?? null)
  }, [candidateCompanies])

  const clearVisibleCandidates = React.useCallback(() => {
    if (!candidateCompanies.length) return
    const visibleIds = new Set(candidateCompanies.map((company) => company.id))
    setDraftIds((current) => {
      const next = current.filter((id) => !visibleIds.has(id))
      setDraftPrimaryId((primary) => {
        if (!primary || !visibleIds.has(primary)) return primary
        return next[0] ?? null
      })
      return next
    })
  }, [candidateCompanies])

  const toggleDraftId = React.useCallback((id: string, checked: boolean) => {
    setDraftIds((current) => {
      if (checked) {
        if (current.includes(id)) return current
        const next = [...current, id]
        setDraftPrimaryId((primary) => primary ?? id)
        return next
      }
      const next = current.filter((entry) => entry !== id)
      setDraftPrimaryId((primary) => {
        if (primary !== id) return primary
        return next[0] ?? null
      })
      return next
    })
  }, [])

  const removeDraftCompany = React.useCallback((id: string) => {
    setDraftIds((current) => {
      const next = current.filter((entry) => entry !== id)
      setDraftPrimaryId((primary) => {
        if (primary !== id) return primary
        return next[0] ?? null
      })
      return next
    })
  }, [])

  const setPrimaryDraftCompany = React.useCallback((id: string) => {
    setDraftPrimaryId(id)
  }, [])

  const handleDialogSave = React.useCallback(async () => {
    const currentIds = linkedCompanies.map((entry) => entry.id)
    const currentPrimaryId = linkedCompanies.find((entry) => entry.isPrimary)?.id ?? linkedCompanies[0]?.id ?? null
    const nextIds = Array.from(new Set(draftIds))
    const nextPrimaryId = nextIds.length
      ? (draftPrimaryId && nextIds.includes(draftPrimaryId) ? draftPrimaryId : nextIds[0])
      : null

    if (!draftSaving && sameIdSet(currentIds, nextIds) && currentPrimaryId === nextPrimaryId) {
      handleDialogOpenChange(false)
      return
    }

    const currentSet = new Set(currentIds)
    const nextSet = new Set(nextIds)
    const removedIds = currentIds.filter((id) => !nextSet.has(id))
    const addedIds = nextIds.filter((id) => !currentSet.has(id))

    setDraftSaving(true)
    try {
      for (const companyId of removedIds) {
        await runWriteMutation(
          () =>
            apiCallOrThrow(`/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(companyId)}`, {
              method: 'DELETE',
            }),
          { companyId, personId, operation: 'removePersonCompanyLink' },
        )
      }

      for (const companyId of addedIds) {
        await runWriteMutation(
          () =>
            apiCallOrThrow(`/api/customers/people/${encodeURIComponent(personId)}/companies`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                companyId,
                isPrimary: nextPrimaryId === companyId,
              }),
            }),
          { companyId, personId, operation: 'addPersonCompanyLink' },
        )
      }

      if (nextPrimaryId && nextPrimaryId !== currentPrimaryId && !addedIds.includes(nextPrimaryId)) {
        await runWriteMutation(
          () =>
            apiCallOrThrow(`/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(nextPrimaryId)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ isPrimary: true }),
            }),
          { companyId: nextPrimaryId, personId, operation: 'setPrimaryPersonCompanyLink' },
        )
      }

      const nextLinkedCompanies = buildLinkedSummary(nextIds, nextPrimaryId, dialogCache, linkedCompanies)
      setLinkedCompanies(nextLinkedCompanies)
      await loadData({ showLoading: false })
      await onChanged?.()
      flash(t('customers.people.detail.companies.manageSuccess', 'Linked companies updated.'), 'success')
      handleDialogOpenChange(false)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('customers.people.detail.companies.manageError', 'Failed to update linked companies.')
      flash(message, 'error')
    } finally {
      setDraftSaving(false)
    }
  }, [
    dialogCache,
    draftIds,
    draftPrimaryId,
    draftSaving,
    handleDialogOpenChange,
    linkedCompanies,
    loadData,
    onChanged,
    personId,
    runWriteMutation,
    t,
  ])

  const handleDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleDialogSave()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleDialogOpenChange(false)
    }
  }, [handleDialogOpenChange, handleDialogSave])

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-[18px] border border-border/70 bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-foreground">
              {t('customers.people.detail.companies.manageTitle', 'Manage linked companies')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('customers.people.detail.companies.summary', '{{count}} linked companies', {
                count: linkedCompanies.length,
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('customers.people.detail.companies.searchPlaceholder', 'Search linked companies…')}
              className="sm:w-[260px]"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Link2 className="mr-2 size-4" />
              {t('customers.people.detail.companies.manageAction', 'Manage links')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as 'name-asc' | 'name-desc' | 'recent')}
            className="h-10 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="name-asc">{t('customers.people.detail.companies.sortNameAsc', 'Sort: Name A-Z')}</option>
            <option value="name-desc">{t('customers.people.detail.companies.sortNameDesc', 'Sort: Name Z-A')}</option>
            <option value="recent">{t('customers.people.detail.companies.sortRecent', 'Sort: Recently active')}</option>
          </select>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((idx) => (
              <div key={idx} className="h-[320px] animate-pulse rounded-[18px] border border-border/60 bg-muted/30" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border/60 px-6 py-12 text-center text-sm text-muted-foreground">
            {search.trim().length
              ? t('customers.people.detail.companies.noSearchResults', 'No linked companies match your search.')
              : t('customers.people.detail.empty.companies', 'No company linked to this person.')}
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {items.map((item) => (
                <CompanyCard
                  key={item.companyId}
                  data={item}
                  personName={personName}
                  statusMap={statusDict?.map}
                  lifecycleMap={lifecycleDict?.map}
                  temperatureMap={temperatureDict?.map}
                  renewalQuarterMap={renewalQuarterDict?.map}
                  roleMap={roleDict?.map}
                />
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-4xl" onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('customers.people.detail.companies.dialogTitle', 'Manage linked companies')}</DialogTitle>
            <DialogDescription>
              {t(
                'customers.people.detail.companies.dialogDescription',
                'Search for one or more companies, update the primary relationship, and remove links without leaving the page.',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={dialogQuery}
                  onChange={(event) => setDialogQuery(event.target.value)}
                  placeholder={t('customers.people.detail.companies.searchAllPlaceholder', 'Search all companies…')}
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="rounded-[16px] border border-border/70 bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                  <div className="text-sm font-semibold text-foreground">
                    {t('customers.people.detail.companies.searchResults', 'Search results')}
                  </div>
                  {candidateCompanies.length ? (
                    <div className="flex items-center gap-2">
                      {selectableVisibleCount > 0 ? (
                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={selectVisibleCandidates}>
                          {t('customers.people.detail.companies.selectVisible', 'Select visible')}
                        </Button>
                      ) : null}
                      {selectedVisibleCount > 0 ? (
                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearVisibleCandidates}>
                          {t('customers.people.detail.companies.clearVisible', 'Clear visible')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {candidateLoading && candidateCompanies.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('customers.people.detail.companies.searchLoading', 'Searching companies…')}
                    </div>
                  ) : candidateCompanies.length ? (
                    <>
                      {candidateCompanies.map((company) => {
                        const checked = selectedSet.has(company.id)
                        return (
                          <label
                            key={company.id}
                            className="flex cursor-pointer items-start gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 hover:bg-accent/30"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleDraftId(company.id, Boolean(value))}
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{company.label}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{company.subtitle || '—'}</div>
                            </div>
                          </label>
                        )
                      })}
                      {candidatePage < candidateTotalPages || candidateLoadingMore ? (
                        <div className="border-t border-border/60 px-4 py-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setCandidatePage((current) => current + 1)}
                            disabled={candidateLoading || candidateLoadingMore}
                          >
                            {candidateLoadingMore ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                            {t('customers.people.detail.companies.loadMore', 'Load more companies')}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('customers.people.detail.companies.searchEmpty', 'No matching companies found.')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-[16px] border border-border/70 bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {t('customers.people.detail.companies.selectedTitle', 'Selected companies')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('customers.people.detail.companies.selectedSummary', '{{count}} companies', {
                      count: draftIds.length,
                    })}
                  </div>
                </div>
              </div>
              <div className="max-h-[420px] overflow-auto">
                {pagedSelectedOptions.length ? (
                  pagedSelectedOptions.map((company) => {
                    const isPrimary = draftPrimaryId === company.id
                    return (
                      <div
                        key={company.id}
                        className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{company.label}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{company.subtitle || '—'}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            variant={isPrimary ? 'default' : 'outline'}
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => setPrimaryDraftCompany(company.id)}
                          >
                            <Star className={cn('mr-1.5 size-3.5', isPrimary ? 'fill-current' : '')} />
                            {isPrimary
                              ? t('customers.people.detail.companies.primaryBadge', 'Primary')
                              : t('customers.people.detail.companies.setPrimary', 'Set primary')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs text-muted-foreground"
                            onClick={() => removeDraftCompany(company.id)}
                          >
                            <X className="mr-1.5 size-3.5" />
                            {t('customers.people.detail.companies.removeAction', 'Remove')}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="px-4 py-6 text-sm text-muted-foreground">
                    {t('customers.people.detail.companies.selectedEmpty', 'No companies selected.')}
                  </div>
                )}
              </div>
              <div className="px-4 pb-4">
                <Pagination page={currentSelectedPage} totalPages={selectedTotalPages} onPageChange={setSelectedPage} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={draftSaving}>
              {t('customers.people.detail.companies.dialogCancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleDialogSave()} disabled={draftSaving}>
              {draftSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('customers.people.detail.companies.dialogSaving', 'Saving…')}
                </>
              ) : (
                t('customers.people.detail.companies.dialogApply', 'Apply')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
