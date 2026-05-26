import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  CompanyAssociationApiRecord,
  DealAssociation,
  DealDetailPayload,
  GuardedMutationRunner,
  PersonAssociationApiRecord,
} from './types'

export function normalizePersonAssociationRecord(
  record: PersonAssociationApiRecord,
  fallbackId: string,
): DealAssociation {
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  const email =
    typeof record.primaryEmail === 'string' && record.primaryEmail.trim().length
      ? record.primaryEmail.trim()
      : typeof record.primary_email === 'string' && record.primary_email.trim().length
        ? record.primary_email.trim()
        : null
  const phone =
    typeof record.primaryPhone === 'string' && record.primaryPhone.trim().length
      ? record.primaryPhone.trim()
      : typeof record.primary_phone === 'string' && record.primary_phone.trim().length
        ? record.primary_phone.trim()
        : null
  const profile = record.personProfile ?? record.person_profile ?? null
  const jobTitle =
    profile && typeof profile.jobTitle === 'string' && profile.jobTitle.trim().length
      ? profile.jobTitle.trim()
      : null
  return {
    id: typeof record.id === 'string' ? record.id : fallbackId,
    label: displayName ?? email ?? phone ?? fallbackId,
    subtitle: jobTitle ?? email ?? phone ?? null,
    kind: 'person',
  }
}

export function normalizeCompanyAssociationRecord(
  record: CompanyAssociationApiRecord,
  fallbackId: string,
): DealAssociation {
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? record.display_name.trim()
        : null
  const profile = record.companyProfile ?? record.company_profile ?? null
  const domain =
    typeof record.domain === 'string' && record.domain.trim().length
      ? record.domain.trim()
      : profile && typeof profile.domain === 'string' && profile.domain.trim().length
        ? profile.domain.trim()
        : null
  const website =
    typeof record.websiteUrl === 'string' && record.websiteUrl.trim().length
      ? record.websiteUrl.trim()
      : typeof record.website_url === 'string' && record.website_url.trim().length
        ? record.website_url.trim()
        : profile && typeof profile.websiteUrl === 'string' && profile.websiteUrl.trim().length
          ? profile.websiteUrl.trim()
          : null
  return {
    id: typeof record.id === 'string' ? record.id : fallbackId,
    label: displayName ?? domain ?? website ?? fallbackId,
    subtitle: domain ?? website ?? null,
    kind: 'company',
  }
}

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

  const loadPeopleAssociations = React.useCallback(async (ids: string[]): Promise<DealAssociation[]> => {
    const uniqueIds = Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)))
    if (!uniqueIds.length) return []
    try {
      const params = new URLSearchParams({
        ids: uniqueIds.join(','),
        pageSize: String(Math.max(uniqueIds.length, 1)),
      })
      const payload = await readApiResultOrThrow<{ items?: PersonAssociationApiRecord[] }>(
        `/api/customers/people?${params.toString()}`,
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const byId = new Map<string, PersonAssociationApiRecord>()
      items.forEach((record) => {
        if (record && typeof record.id === 'string') byId.set(record.id, record)
      })
      return uniqueIds.map((personId) => {
        const record = byId.get(personId)
        return record
          ? normalizePersonAssociationRecord(record, personId)
          : {
              id: personId,
              label: personId,
              subtitle: null,
              kind: 'person' as const,
            }
      })
    } catch {
      return uniqueIds.map((personId) => ({
        id: personId,
        label: personId,
        subtitle: null,
        kind: 'person' as const,
      }))
    }
  }, [])

  const loadCompanyAssociations = React.useCallback(async (ids: string[]): Promise<DealAssociation[]> => {
    const uniqueIds = Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)))
    if (!uniqueIds.length) return []
    try {
      const params = new URLSearchParams({
        ids: uniqueIds.join(','),
        pageSize: String(Math.max(uniqueIds.length, 1)),
      })
      const payload = await readApiResultOrThrow<{ items?: CompanyAssociationApiRecord[] }>(
        `/api/customers/companies?${params.toString()}`,
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const byId = new Map<string, CompanyAssociationApiRecord>()
      items.forEach((record) => {
        if (record && typeof record.id === 'string') byId.set(record.id, record)
      })
      return uniqueIds.map((companyId) => {
        const record = byId.get(companyId)
        return record
          ? normalizeCompanyAssociationRecord(record, companyId)
          : {
              id: companyId,
              label: companyId,
              subtitle: null,
              kind: 'company' as const,
            }
      })
    } catch {
      return uniqueIds.map((companyId) => ({
        id: companyId,
        label: companyId,
        subtitle: null,
        kind: 'company' as const,
      }))
    }
  }, [])

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
          () => updateCrud('customers/deals', { id: currentDealId, personIds: nextIds }),
          { id: currentDealId, personIds: nextIds, operation: 'updateDealPeople' },
        )
        const nextPeople = await loadPeopleAssociations(nextIds.slice(0, 3))
        setData((prev) =>
          prev
            ? {
                ...prev,
                people: nextPeople,
                linkedPersonIds: nextIds,
                counts: { ...prev.counts, people: nextIds.length },
              }
            : prev,
        )
      } catch {
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
        flash(t('customers.deals.detail.peopleUpdateError', 'Failed to update linked people.'), 'error')
      } finally {
        setPeopleSaving(false)
      }
    },
    [currentDealId, data?.people, loadPeopleAssociations, peopleEditorIds, runMutationWithContext, setData, t],
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
          () => updateCrud('customers/deals', { id: currentDealId, companyIds: nextIds }),
          { id: currentDealId, companyIds: nextIds, operation: 'updateDealCompanies' },
        )
        const nextCompanies = await loadCompanyAssociations(nextIds.slice(0, 3))
        setData((prev) =>
          prev
            ? {
                ...prev,
                companies: nextCompanies,
                linkedCompanyIds: nextIds,
                counts: { ...prev.counts, companies: nextIds.length },
              }
            : prev,
        )
      } catch {
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
        flash(t('customers.deals.detail.companiesUpdateError', 'Failed to update linked companies.'), 'error')
      } finally {
        setCompaniesSaving(false)
      }
    },
    [
      companiesEditorIds,
      currentDealId,
      data?.companies,
      loadCompanyAssociations,
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
