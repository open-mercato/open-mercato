'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, Link2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { CompanyCard, type EnrichedCompanyData } from './CompanyCard'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'
import { LinkEntityDialog, type LinkEntityOption } from '../linking/LinkEntityDialog'
import { createCompanyLinkAdapter } from '../linking/adapters/companyAdapter'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type LinkedCompanySummary = {
  id: string
  displayName: string
  isPrimary: boolean
}

type PersonCompaniesSectionProps = {
  personId: string
  personName: string
  initialLinkedCompanies?: LinkedCompanySummary[]
  onChanged?: () => Promise<void> | void
  runGuardedMutation?: GuardedMutationRunner
}

const LINKED_PAGE_SIZE = 20

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
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
  personName: _personName,
  initialLinkedCompanies = [],
  onChanged,
  runGuardedMutation,
}: PersonCompaniesSectionProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [items, setItems] = React.useState<EnrichedCompanyData[]>([])
  const [loading, setLoading] = React.useState(true)
  const [unlinkingId, setUnlinkingId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<'name-asc' | 'name-desc' | 'recent'>('name-asc')
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [linkedCompanies, setLinkedCompanies] = React.useState<LinkedCompanySummary[]>(
    initialLinkedCompanies,
  )
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const { data: statusDict } = useCustomerDictionary('statuses')
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages')
  const { data: temperatureDict } = useCustomerDictionary('temperature')
  const { data: renewalQuarterDict } = useCustomerDictionary('renewal-quarters')
  const { data: roleDict } = useCustomerDictionary('person-company-roles')

  React.useEffect(() => {
    setLinkedCompanies(initialLinkedCompanies)
  }, [initialLinkedCompanies])

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

  const loadData = React.useCallback(
    async (options?: { showLoading?: boolean }) => {
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
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('customers.people.detail.companies.loadError', 'Failed to load companies.')
        flash(message, 'error')
        setItems([])
        setTotalPages(1)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [page, personId, search, sort, t],
  )

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  React.useEffect(() => {
    setPage(1)
  }, [search, sort])

  const linkedIds = React.useMemo(
    () => linkedCompanies.map((entry) => entry.id),
    [linkedCompanies],
  )
  const linkedPrimaryId = React.useMemo(
    () =>
      linkedCompanies.find((entry) => entry.isPrimary)?.id ??
      linkedCompanies[0]?.id ??
      null,
    [linkedCompanies],
  )

  const companyLinkAdapter = React.useMemo(
    () =>
      createCompanyLinkAdapter({
        dialogTitle: t('customers.linking.company.dialogTitle', 'Link company'),
        dialogSubtitle: _personName
          ? t('customers.linking.company.dialogSubtitleFor', 'Link an existing company to {{name}}', {
              name: _personName,
            })
          : t('customers.linking.company.dialogSubtitle', 'Link an existing company to this person'),
        sectionLabel: t('customers.linking.company.sectionLabel', 'MATCHING COMPANIES'),
        searchPlaceholder: t(
          'customers.linking.company.searchPlaceholder',
          'Search all companies…',
        ),
        searchEmptyHint: t(
          'customers.linking.company.searchEmpty',
          'No matching companies found.',
        ),
        selectedEmptyHint: t(
          'customers.linking.company.selectedEmpty',
          'No companies selected.',
        ),
        confirmButtonLabel: t('customers.linking.company.confirmButton', 'Link company'),
        excludeLinkedPersonId: personId,
      }),
    [_personName, personId, t],
  )

  const handleLinkConfirm = React.useCallback(
    async ({
      addedIds,
      removedIds,
      nextSelectedIds,
      primaryId,
      optionsById,
    }: {
      addedIds: string[]
      removedIds: string[]
      nextSelectedIds: string[]
      primaryId?: string | null
      optionsById: Record<string, LinkEntityOption>
    }) => {
      const currentPrimaryId = linkedPrimaryId
      const nextPrimaryId = nextSelectedIds.length
        ? primaryId && nextSelectedIds.includes(primaryId)
          ? primaryId
          : nextSelectedIds[0]
        : null

      try {
        for (const companyId of removedIds) {
          await runWriteMutation(
            () =>
              apiCallOrThrow(
                `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(companyId)}`,
                { method: 'DELETE' },
              ),
            { companyId, personId, operation: 'removePersonCompanyLink' },
          )
        }

        for (const companyId of addedIds) {
          await runWriteMutation(
            () =>
              apiCallOrThrow(
                `/api/customers/people/${encodeURIComponent(personId)}/companies`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    companyId,
                    isPrimary: nextPrimaryId === companyId,
                  }),
                },
              ),
            { companyId, personId, operation: 'addPersonCompanyLink' },
          )
        }

        if (
          nextPrimaryId &&
          nextPrimaryId !== currentPrimaryId &&
          !addedIds.includes(nextPrimaryId)
        ) {
          await runWriteMutation(
            () =>
              apiCallOrThrow(
                `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(nextPrimaryId)}`,
                {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ isPrimary: true }),
                },
              ),
            { companyId: nextPrimaryId, personId, operation: 'setPrimaryPersonCompanyLink' },
          )
        }

        const nextLinkedCompanies: LinkedCompanySummary[] = nextSelectedIds.map((id) => {
          const option = optionsById[id]
          const fromCurrent = linkedCompanies.find((entry) => entry.id === id)
          return {
            id,
            displayName: option?.label ?? fromCurrent?.displayName ?? id,
            isPrimary: id === nextPrimaryId,
          }
        })
        setLinkedCompanies(nextLinkedCompanies)
        await loadData({ showLoading: false })
        await onChanged?.()
        flash(
          t('customers.people.detail.companies.manageSuccess', 'Linked companies updated.'),
          'success',
        )
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t(
                'customers.people.detail.companies.manageError',
                'Failed to update linked companies.',
              )
        flash(message, 'error')
        throw error
      }
    },
    [linkedCompanies, linkedPrimaryId, loadData, onChanged, personId, runWriteMutation, t],
  )

  const handleUnlink = React.useCallback(
    async (companyId: string, displayName: string) => {
      if (!companyId || unlinkingId) return
      const confirmed = await confirm({
        title: t('customers.people.detail.companies.unlinkConfirmTitle', 'Unlink company'),
        description: t(
          'customers.people.detail.companies.unlinkConfirm',
          'Unlink {{company}} from {{person}}?',
          { company: displayName, person: _personName },
        ),
        confirmText: t('customers.people.detail.companies.unlinkAction', 'Unlink'),
        cancelText: t('customers.linking.actions.cancel', 'Cancel'),
      })
      if (!confirmed) return
      setUnlinkingId(companyId)
      try {
        await runWriteMutation(
          () =>
            apiCallOrThrow(
              `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(companyId)}`,
              { method: 'DELETE' },
              {
                errorMessage: t(
                  'customers.people.detail.companies.unlinkError',
                  'Failed to unlink company.',
                ),
              },
            ),
          { companyId, personId, operation: 'unlinkPersonCompanyLink' },
        )
        await loadData({ showLoading: false })
        await onChanged?.()
        flash(
          t('customers.people.detail.companies.unlinkSuccess', 'Company unlinked.'),
          'success',
        )
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : t(
              'customers.people.detail.companies.unlinkError',
              'Failed to unlink company.',
            )
        flash(message, 'error')
      } finally {
        setUnlinkingId(null)
      }
    },
    [_personName, confirm, loadData, onChanged, personId, runWriteMutation, t, unlinkingId],
  )

  useAppEvent('customers.person_company_link.deleted', (event) => {
    const payload = event.payload as { personEntityId?: string | null } | null | undefined
    if (payload && payload.personEntityId === personId) {
      void loadData({ showLoading: false })
    }
  }, [personId, loadData])

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
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
              placeholder={t(
                'customers.people.detail.companies.searchPlaceholder',
                'Search linked companies…',
              )}
              className="sm:w-[260px]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              <Link2 className="mr-2 size-4" />
              {t('customers.people.detail.companies.manageAction', 'Manage links')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as 'name-asc' | 'name-desc' | 'recent')
            }
            className="h-10 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="name-asc">
              {t('customers.people.detail.companies.sortNameAsc', 'Sort: Name A-Z')}
            </option>
            <option value="name-desc">
              {t('customers.people.detail.companies.sortNameDesc', 'Sort: Name Z-A')}
            </option>
            <option value="recent">
              {t('customers.people.detail.companies.sortRecent', 'Sort: Recently active')}
            </option>
          </select>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((idx) => (
              <div
                key={idx}
                className="h-[320px] animate-pulse rounded-2xl border border-border/60 bg-muted/30"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center text-sm text-muted-foreground">
            {search.trim().length
              ? t(
                  'customers.people.detail.companies.noSearchResults',
                  'No linked companies match your search.',
                )
              : t(
                  'customers.people.detail.empty.companies',
                  'No company linked to this person.',
                )}
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {items.map((item) => (
                <CompanyCard
                  key={item.companyId}
                  data={item}
                  personName={_personName}
                  statusMap={statusDict?.map}
                  lifecycleMap={lifecycleDict?.map}
                  temperatureMap={temperatureDict?.map}
                  renewalQuarterMap={renewalQuarterDict?.map}
                  roleMap={roleDict?.map}
                  onUnlink={() => handleUnlink(item.companyId, item.displayName)}
                  unlinkLabel={t('customers.people.detail.companies.unlinkAction', 'Unlink')}
                  unlinkDisabled={unlinkingId === item.companyId}
                />
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>

      <LinkEntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        adapter={companyLinkAdapter}
        initialSelectedIds={linkedIds}
        initialPrimaryId={linkedPrimaryId}
        primarySupported
        onConfirm={handleLinkConfirm}
        runGuardedMutation={runWriteMutation}
      />
      {ConfirmDialogElement}
    </>
  )
}

export default PersonCompaniesSection

export { sameIdSet }
