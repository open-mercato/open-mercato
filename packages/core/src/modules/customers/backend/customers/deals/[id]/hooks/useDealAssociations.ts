import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  DealAssociation,
  DealDetailPayload,
  GuardedMutationRunner,
} from './types'

function sameIdList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

type LinkedPageResult = {
  items: DealAssociation[]
  totalPages: number
  total: number
}

type UseDealAssociationsOptions = {
  currentDealId: string | null
  data: DealDetailPayload | null
  setData: React.Dispatch<React.SetStateAction<DealDetailPayload | null>>
  runMutationWithContext: GuardedMutationRunner
  /**
   * Re-fetch the deal detail. Wired into the conflict bar's refresh action on a 409, and
   * awaited after a successful link save: the deal's `updated_at` is the lock token these
   * writes send, and the server now advances it whenever the links change, so a page that
   * kept its old token would 409 against its own next write.
   */
  onRefresh?: (() => void | Promise<void>) | null
}

type UseDealAssociationsResult = {
  peopleEditorIds: string[]
  companiesEditorIds: string[]
  peopleSaving: boolean
  companiesSaving: boolean
  handlePeopleAssociationsChange: (nextIds: string[]) => Promise<void>
  handleCompaniesAssociationsChange: (nextIds: string[]) => Promise<void>
  loadLinkedPeoplePage: (page: number, query: string) => Promise<LinkedPageResult>
  loadLinkedCompaniesPage: (page: number, query: string) => Promise<LinkedPageResult>
}

export function useDealAssociations({
  currentDealId,
  data,
  setData,
  runMutationWithContext,
  onRefresh,
}: UseDealAssociationsOptions): UseDealAssociationsResult {
  const t = useT()
  const [peopleEditorIds, setPeopleEditorIds] = React.useState<string[]>([])
  const [companiesEditorIds, setCompaniesEditorIds] = React.useState<string[]>([])
  const [peopleSaving, setPeopleSaving] = React.useState(false)
  const [companiesSaving, setCompaniesSaving] = React.useState(false)

  React.useEffect(() => {
    setPeopleEditorIds(data?.linkedPersonIds ?? [])
    setCompaniesEditorIds(data?.linkedCompanyIds ?? [])
  }, [data?.linkedCompanyIds, data?.linkedPersonIds])

  const loadLinkedPeoplePage = React.useCallback(
    async (page: number, query: string): Promise<LinkedPageResult> => {
      if (!currentDealId) {
        return { items: [], totalPages: 1, total: 0 }
      }
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        sort: 'name-asc',
      })
      if (query.trim().length > 0) {
        params.set('search', query.trim())
      }
      const payload = await readApiResultOrThrow<{
        items?: DealAssociation[]
        total?: number
        totalPages?: number
      }>(`/api/customers/deals/${encodeURIComponent(currentDealId)}/people?${params.toString()}`)
      return {
        items: Array.isArray(payload.items) ? payload.items : [],
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
        total: typeof payload.total === 'number' ? payload.total : 0,
      }
    },
    [currentDealId],
  )

  const loadLinkedCompaniesPage = React.useCallback(
    async (page: number, query: string): Promise<LinkedPageResult> => {
      if (!currentDealId) {
        return { items: [], totalPages: 1, total: 0 }
      }
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        sort: 'name-asc',
      })
      if (query.trim().length > 0) {
        params.set('search', query.trim())
      }
      const payload = await readApiResultOrThrow<{
        items?: DealAssociation[]
        total?: number
        totalPages?: number
      }>(`/api/customers/deals/${encodeURIComponent(currentDealId)}/companies?${params.toString()}`)
      return {
        items: Array.isArray(payload.items) ? payload.items : [],
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
        total: typeof payload.total === 'number' ? payload.total : 0,
      }
    },
    [currentDealId],
  )

  const handlePeopleAssociationsChange = React.useCallback(
    async (nextIds: string[]) => {
      if (!currentDealId) return
      if (sameIdList(nextIds, peopleEditorIds)) return
      const previousIds = peopleEditorIds
      const previousPeople = data?.people ?? []
      setPeopleEditorIds(nextIds)
      setPeopleSaving(true)
      try {
        await runMutationWithContext(
          () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(data?.deal.updatedAt),
            () => updateCrud('customers/deals', { id: currentDealId, personIds: nextIds }),
          ),
          { id: currentDealId, personIds: nextIds, operation: 'updateDealPeople' },
        )
        // The deal has to be re-read: `updated_at` is the optimistic-lock token this save
        // sends, and the server advances it whenever the links change, so a page holding the
        // superseded version would 409 against its own next write. The reload carries the
        // refreshed `people` / `linkedPersonIds` / `counts` with it, so patching them from a
        // separate lookup first would only be overwritten one round trip later.
        await onRefresh?.()
      } catch (error) {
        setPeopleEditorIds(previousIds)
        setData((prev) =>
          prev
            ? {
                ...prev,
                people: previousPeople,
                linkedPersonIds: previousIds,
                counts: { ...prev.counts, people: previousIds.length },
              }
            : prev,
        )
        // runMutationWithContext already surfaces the conflict bar on a 409; only
        // fall back to the generic flash when this is not a record conflict.
        if (!surfaceRecordConflict(error, t, { onRefresh: onRefresh ?? null })) {
          flash(t('customers.deals.detail.peopleUpdateError', 'Failed to update linked people.'), 'error')
        }
      } finally {
        setPeopleSaving(false)
      }
    },
    [currentDealId, data?.deal.updatedAt, data?.people, onRefresh, peopleEditorIds, runMutationWithContext, setData, t],
  )

  const handleCompaniesAssociationsChange = React.useCallback(
    async (nextIds: string[]) => {
      if (!currentDealId) return
      if (sameIdList(nextIds, companiesEditorIds)) return
      const previousIds = companiesEditorIds
      const previousCompanies = data?.companies ?? []
      setCompaniesEditorIds(nextIds)
      setCompaniesSaving(true)
      try {
        await runMutationWithContext(
          () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(data?.deal.updatedAt),
            () => updateCrud('customers/deals', { id: currentDealId, companyIds: nextIds }),
          ),
          { id: currentDealId, companyIds: nextIds, operation: 'updateDealCompanies' },
        )
        // See the people handler above: the reload refreshes the lock token and the list.
        await onRefresh?.()
      } catch (error) {
        setCompaniesEditorIds(previousIds)
        setData((prev) =>
          prev
            ? {
                ...prev,
                companies: previousCompanies,
                linkedCompanyIds: previousIds,
                counts: { ...prev.counts, companies: previousIds.length },
              }
            : prev,
        )
        // runMutationWithContext already surfaces the conflict bar on a 409; only
        // fall back to the generic flash when this is not a record conflict.
        if (!surfaceRecordConflict(error, t, { onRefresh: onRefresh ?? null })) {
          flash(t('customers.deals.detail.companiesUpdateError', 'Failed to update linked companies.'), 'error')
        }
      } finally {
        setCompaniesSaving(false)
      }
    },
    [
      companiesEditorIds,
      currentDealId,
      data?.companies,
      data?.deal.updatedAt,
      onRefresh,
      runMutationWithContext,
      setData,
      t,
    ],
  )

  return {
    peopleEditorIds,
    companiesEditorIds,
    peopleSaving,
    companiesSaving,
    handlePeopleAssociationsChange,
    handleCompaniesAssociationsChange,
    loadLinkedPeoplePage,
    loadLinkedCompaniesPage,
  }
}
