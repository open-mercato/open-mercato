"use client"

import * as React from 'react'
import Link from 'next/link'
import { Building2, Users } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { AttachmentsSection, ErrorMessage, LoadingMessage, NotesSection } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { CollapsibleZoneLayout } from '@open-mercato/ui/backend/crud/CollapsibleZoneLayout'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { E } from '#generated/entities.ids.generated'

import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { ChangelogTab } from '../../../../components/detail/ChangelogTab'
import { DealClosureActionBar } from '../../../../components/detail/DealClosureActionBar'
import { DealDetailHeader } from '../../../../components/detail/DealDetailHeader'
import { DealDetailTabs, resolveLegacyTab, type DealTabId } from '../../../../components/detail/DealDetailTabs'
import { DealForm, type DealFormSubmitPayload, useDealAssociationLookups } from '../../../../components/detail/DealForm'
import { DealLinkedEntitiesTab } from '../../../../components/detail/DealLinkedEntitiesTab'
import { DealLostDialog } from '../../../../components/detail/DealLostDialog'
import { DealLostPopup } from '../../../../components/detail/DealLostPopup'
import { DealWonPopup } from '../../../../components/detail/DealWonPopup'
import { InlineActivityComposer } from '../../../../components/detail/InlineActivityComposer'
import { PipelineStepper } from '../../../../components/detail/PipelineStepper'
import { PlannedActivitiesSection } from '../../../../components/detail/PlannedActivitiesSection'
import { ScheduleActivityDialog, type ScheduleActivityEditData } from '../../../../components/detail/ScheduleActivityDialog'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import type { InteractionSummary } from '../../../../components/detail/types'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
}

type PersonAssociationApiRecord = {
  id?: string
  displayName?: string | null
  display_name?: string | null
  primaryEmail?: string | null
  primary_email?: string | null
  primaryPhone?: string | null
  primary_phone?: string | null
  personProfile?: { jobTitle?: string | null } | null
  person_profile?: { jobTitle?: string | null } | null
}

type CompanyAssociationApiRecord = {
  id?: string
  displayName?: string | null
  display_name?: string | null
  domain?: string | null
  websiteUrl?: string | null
  website_url?: string | null
  companyProfile?: { domain?: string | null; websiteUrl?: string | null } | null
  company_profile?: { domain?: string | null; websiteUrl?: string | null } | null
}

type PipelineStageInfo = {
  id: string
  label: string
  order: number
  color: string | null
  icon: string | null
}

type StageTransitionInfo = {
  stageId: string
  stageLabel: string
  stageOrder: number
  transitionedAt: string
}

type DealDetailPayload = {
  deal: {
    id: string
    title: string
    description: string | null
    status: string | null
    pipelineStage: string | null
    pipelineId: string | null
    pipelineStageId: string | null
    valueAmount: string | null
    valueCurrency: string | null
    probability: number | null
    expectedCloseAt: string | null
    ownerUserId: string | null
    source: string | null
    closureOutcome: 'won' | 'lost' | null
    lossReasonId: string | null
    lossNotes: string | null
    organizationId: string | null
    tenantId: string | null
    createdAt: string
    updatedAt: string
  }
  people: DealAssociation[]
  companies: DealAssociation[]
  linkedPersonIds: string[]
  linkedCompanyIds: string[]
  counts: {
    people: number
    companies: number
  }
  customFields: Record<string, unknown>
  viewer: {
    userId: string | null
    name: string | null
    email: string | null
  } | null
  pipelineStages: PipelineStageInfo[]
  pipelineName: string | null
  stageTransitions: StageTransitionInfo[]
  owner: { id: string; name: string; email: string } | null
}

type DealStatsPayload = {
  dealValue: number | null
  dealCurrency: string | null
  closureOutcome: 'won' | 'lost'
  closedAt: string
  pipelineName: string | null
  dealsClosedThisPeriod: number
  salesCycleDays: number | null
  dealRankInQuarter: number | null
  lossReason: string | null
}

function formatCurrency(amount: string | null, currency: string | null): string | null {
  if (!amount) return null
  const parsed = Number(amount)
  if (!Number.isFinite(parsed)) return currency ? `${amount} ${currency}` : amount
  if (!currency) return parsed.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(parsed)
  } catch {
    return `${parsed.toLocaleString()} ${currency}`
  }
}

function sameIdList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function normalizePersonAssociationRecord(record: PersonAssociationApiRecord, fallbackId: string): DealAssociation {
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

function normalizeCompanyAssociationRecord(record: CompanyAssociationApiRecord, fallbackId: string): DealAssociation {
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

function startOfNextQuarter(baseDate: Date): Date {
  const year = baseDate.getFullYear()
  const currentQuarter = Math.floor(baseDate.getMonth() / 3)
  const nextQuarter = currentQuarter + 1
  if (nextQuarter >= 4) return new Date(year + 1, 0, 1, 10, 0, 0, 0)
  return new Date(year, nextQuarter * 3, 1, 10, 0, 0, 0)
}

export default function DealDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? ''
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])

  const [data, setData] = React.useState<DealDetailPayload | null>(null)
  const [plannedActivities, setPlannedActivities] = React.useState<InteractionSummary[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isDirty, setIsDirty] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleEditData, setScheduleEditData] = React.useState<ScheduleActivityEditData | null>(null)
  const [lostDialogOpen, setLostDialogOpen] = React.useState(false)
  const [wonPopupOpen, setWonPopupOpen] = React.useState(false)
  const [lostPopupOpen, setLostPopupOpen] = React.useState(false)
  const [wonStats, setWonStats] = React.useState<DealStatsPayload | null>(null)
  const [lostStats, setLostStats] = React.useState<DealStatsPayload | null>(null)
  const [isStageSaving, setIsStageSaving] = React.useState(false)
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)
  const [peopleEditorIds, setPeopleEditorIds] = React.useState<string[]>([])
  const [companiesEditorIds, setCompaniesEditorIds] = React.useState<string[]>([])
  const [peopleSaving, setPeopleSaving] = React.useState(false)
  const [companiesSaving, setCompaniesSaving] = React.useState(false)
  const formWrapperRef = React.useRef<HTMLDivElement>(null)
  const initialLoadDoneRef = React.useRef(false)

  const initialTab = React.useMemo(() => resolveLegacyTab(searchParams?.get('tab')), [searchParams])
  const [activeTab, setActiveTab] = React.useState<DealTabId>(initialTab)

  React.useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  const currentDealId = data?.deal.id ?? id
  const mutationContextId = React.useMemo(
    () => (currentDealId ? `customer-deal:${currentDealId}` : `customer-deal:${id || 'pending'}`),
    [currentDealId, id],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    dealId?: string | null
    resourceKind: string
    resourceId?: string
    data: DealDetailPayload | null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const injectionContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      dealId: currentDealId,
      resourceKind: 'customers.deal',
      resourceId: currentDealId ?? undefined,
      data,
      retryLastMutation,
    }),
    [currentDealId, data, mutationContextId, retryLastMutation],
  )

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: injectionContext,
      })
    },
    [injectionContext, runMutation],
  )

  const { widgets: injectedTabWidgets } = useInjectionWidgets('detail:customers.deal:tabs', {
    context: injectionContext,
    triggerOnLoad: true,
  })

  const injectedTabs = React.useMemo(
    () =>
      (injectedTabWidgets ?? [])
        .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
        .map((widget) => {
          const tabId = widget.placement?.groupId ?? widget.widgetId
          const label = widget.placement?.groupLabel ?? widget.module.metadata.title ?? tabId
          const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
          const render = () => (
            <widget.module.Widget
              context={injectionContext}
              data={data}
              onDataChange={(next: unknown) => setData(next as DealDetailPayload)}
            />
          )
          return { id: tabId, label, priority, render }
        })
        .sort((left, right) => right.priority - left.priority),
    [data, injectedTabWidgets, injectionContext],
  )

  const injectedTabMap = React.useMemo(
    () => new Map(injectedTabs.map((tab) => [tab.id, tab.render])),
    [injectedTabs],
  )

  React.useEffect(() => {
    setPeopleEditorIds(data?.linkedPersonIds ?? [])
    setCompaniesEditorIds(data?.linkedCompanyIds ?? [])
  }, [data?.linkedCompanyIds, data?.linkedPersonIds])

  const { searchPeoplePage, fetchPeopleByIds, searchCompaniesPage, fetchCompaniesByIds } = useDealAssociationLookups({
    excludeLinkedDealId: data?.deal.id ?? null,
  })

  const loadData = React.useCallback(async () => {
    if (!id) {
      setError(t('customers.deals.detail.error.notFound', 'Deal not found.'))
      setIsLoading(false)
      return
    }
    if (!initialLoadDoneRef.current) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const payload = await readApiResultOrThrow<DealDetailPayload>(
        `/api/customers/deals/${encodeURIComponent(id)}?include=stages&view=lite`,
        undefined,
        { errorMessage: t('customers.deals.detail.error.load', 'Failed to load deal.') },
      )
      setData(payload)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : t('customers.deals.detail.error.load', 'Failed to load deal.')
      setError(message)
      if (!initialLoadDoneRef.current) setData(null)
    } finally {
      setIsLoading(false)
      initialLoadDoneRef.current = true
    }
  }, [id, t])

  const loadPlannedActivities = React.useCallback(async () => {
    if (!id) return
    try {
      const result = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
        `/api/customers/interactions?dealId=${encodeURIComponent(id)}&status=planned&excludeInteractionType=task&limit=100&sortField=scheduledAt&sortDir=asc`,
      )
      setPlannedActivities(Array.isArray(result.items) ? result.items : [])
    } catch {
      setPlannedActivities([])
    }
  }, [id])

  React.useEffect(() => {
    void Promise.all([loadData(), loadPlannedActivities()])
  }, [loadData, loadPlannedActivities])

  const defaultActivityEntity = React.useMemo(
    () => {
      const firstPerson = data?.people[0]
      if (firstPerson) return { id: firstPerson.id, label: firstPerson.label, kind: 'person' as const }
      const firstCompany = data?.companies[0]
      if (firstCompany) return { id: firstCompany.id, label: firstCompany.label, kind: 'company' as const }
      return null
    },
    [data?.companies, data?.people],
  )

  const dealOptions = React.useMemo(
    () => data ? [{ id: data.deal.id, label: data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal') }] : [],
    [data, t],
  )

  const entityOptions = React.useMemo(() => {
    if (!data) return []
    return [...data.people, ...data.companies].map((entry) => ({
      id: entry.id,
      label: entry.subtitle ? `${entry.label} · ${entry.subtitle}` : entry.label,
    }))
  }, [data])

  const handleTabChange = React.useCallback((tab: DealTabId) => {
    setActiveTab(tab)
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
    nextParams.set('tab', tab)
    router.replace(`/backend/customers/deals/${encodeURIComponent(id)}?${nextParams.toString()}`, { scroll: false })
  }, [id, router, searchParams])

  const handleFormSubmit = React.useCallback(async (payload: DealFormSubmitPayload) => {
    if (!data) return
    setIsSaving(true)
    try {
      await updateCrud('customers/deals', {
        id: data.deal.id,
        ...payload.base,
        ...payload.custom,
      })
      flash(t('customers.deals.detail.updateSuccess', 'Deal updated.'), 'success')
      await loadData()
    } finally {
      setIsSaving(false)
    }
  }, [data, loadData, t])

  const handleDelete = React.useCallback(async () => {
    if (!data || !currentDealId) return
    const approved = await confirm({
      title: t('customers.deals.detail.deleteConfirmTitle', 'Delete deal?'),
      description: t('customers.deals.detail.deleteConfirmDescription', 'This action cannot be undone.'),
      confirmText: t('customers.deals.detail.actions.delete', 'Delete'),
      cancelText: t('customers.deals.detail.actions.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!approved) return
    await runMutationWithContext(
      () => deleteCrud('customers/deals', currentDealId),
      { id: currentDealId, operation: 'deleteDeal' },
    )
    flash(t('customers.deals.detail.deleteSuccess', 'Deal deleted.'), 'success')
    router.push('/backend/customers/deals')
  }, [confirm, currentDealId, data, router, runMutationWithContext, t])

  const handleHeaderSave = React.useCallback(() => {
    const form = formWrapperRef.current?.querySelector('form')
    if (form) form.requestSubmit()
  }, [])

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
    async (page: number, query: string) => {
      if (!currentDealId) {
        return { items: [] as DealAssociation[], totalPages: 1, total: 0 }
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
    async (page: number, query: string) => {
      if (!currentDealId) {
        return { items: [] as DealAssociation[], totalPages: 1, total: 0 }
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

  const handlePeopleAssociationsChange = React.useCallback(async (nextIds: string[]) => {
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
  }, [currentDealId, data?.people, loadPeopleAssociations, peopleEditorIds, runMutationWithContext, t])

  const handleCompaniesAssociationsChange = React.useCallback(async (nextIds: string[]) => {
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
  }, [companiesEditorIds, currentDealId, data?.companies, loadCompanyAssociations, runMutationWithContext, t])

  const handleActivityCreated = React.useCallback(async () => {
    setActivityRefreshKey((value) => value + 1)
    await loadPlannedActivities()
  }, [loadPlannedActivities])

  const handleMarkDone = React.useCallback(async (interactionId: string) => {
    try {
      await runMutationWithContext(
        () => apiCallOrThrow('/api/customers/interactions/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: interactionId, occurredAt: new Date().toISOString() }),
        }),
        { id: interactionId, status: 'done', operation: 'completeActivity' },
      )
      flash(t('customers.timeline.planned.completed', 'Activity completed'), 'success')
      await handleActivityCreated()
    } catch {
      flash(t('customers.timeline.planned.error', 'Failed to complete activity'), 'error')
    }
  }, [handleActivityCreated, runMutationWithContext, t])

  const handleCancelActivity = React.useCallback(async (interactionId: string) => {
    try {
      await runMutationWithContext(
        () => apiCallOrThrow('/api/customers/interactions', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: interactionId, status: 'canceled' }),
        }),
        { id: interactionId, status: 'canceled', operation: 'cancelActivity' },
      )
      flash(t('customers.timeline.planned.canceled', 'Activity canceled'), 'success')
      await handleActivityCreated()
    } catch {
      flash(t('customers.timeline.planned.cancelError', 'Failed to cancel activity'), 'error')
    }
  }, [handleActivityCreated, runMutationWithContext, t])

  const handleEditActivity = React.useCallback((activity: InteractionSummary) => {
    setScheduleEditData({
      id: activity.id,
      interactionType: activity.interactionType,
      title: activity.title ?? null,
      body: activity.body ?? null,
      scheduledAt: activity.scheduledAt ?? null,
      durationMinutes: activity.duration ?? null,
      location: activity.location ?? null,
      allDay: activity.allDay ?? null,
      recurrenceRule: activity.recurrenceRule ?? null,
      recurrenceEnd: activity.recurrenceEnd ?? null,
      participants: activity.participants ?? null,
      reminderMinutes: activity.reminderMinutes ?? null,
      visibility: activity.visibility ?? null,
      linkedEntities: null,
    })
    setScheduleDialogOpen(true)
  }, [])

  const fetchDealStats = React.useCallback(async (): Promise<DealStatsPayload | null> => {
    if (!currentDealId) return null
    try {
      return await readApiResultOrThrow<DealStatsPayload>(`/api/customers/deals/${encodeURIComponent(currentDealId)}/stats`)
    } catch (statsError) {
      console.error('customers.deals.detail.stats failed', statsError)
      return null
    }
  }, [currentDealId])

  const handleWon = React.useCallback(async () => {
    if (!currentDealId) return
    await runMutationWithContext(
      () => updateCrud('customers/deals', { id: currentDealId, closureOutcome: 'won', status: 'win' }),
      { id: currentDealId, closureOutcome: 'won', status: 'win', operation: 'closeWon' },
    )
    const stats = await fetchDealStats()
    setWonStats(stats)
    setWonPopupOpen(true)
    await loadData()
  }, [currentDealId, fetchDealStats, loadData, runMutationWithContext])

  const handleLostConfirm = React.useCallback(async (input: { lossReasonId: string; lossNotes?: string }) => {
    if (!currentDealId) return
    await runMutationWithContext(
      () => updateCrud('customers/deals', {
        id: currentDealId,
        closureOutcome: 'lost',
        status: 'loose',
        lossReasonId: input.lossReasonId,
        lossNotes: input.lossNotes ?? null,
      }),
      {
        id: currentDealId,
        closureOutcome: 'lost',
        status: 'loose',
        lossReasonId: input.lossReasonId,
        lossNotes: input.lossNotes ?? null,
        operation: 'closeLost',
      },
    )
    setLostDialogOpen(false)
    const stats = await fetchDealStats()
    setLostStats(stats)
    setLostPopupOpen(true)
    await loadData()
  }, [currentDealId, fetchDealStats, loadData, runMutationWithContext])

  const handleStageChange = React.useCallback(async (nextStageId: string) => {
    if (!currentDealId || !data) return
    if (nextStageId === data.deal.pipelineStageId) return
    setIsStageSaving(true)
    try {
      await runMutationWithContext(
        () => updateCrud('customers/deals', { id: currentDealId, pipelineStageId: nextStageId }),
        { id: currentDealId, pipelineStageId: nextStageId, operation: 'updateDealStage' },
      )
      flash(t('customers.deals.detail.stageUpdateSuccess', 'Deal stage updated.'), 'success')
      await loadData()
    } catch {
      flash(t('customers.deals.detail.stageUpdateError', 'Failed to update deal stage.'), 'error')
    } finally {
      setIsStageSaving(false)
    }
  }, [currentDealId, data, loadData, runMutationWithContext, t])

  const handleViewDashboard = React.useCallback(() => {
    setWonPopupOpen(false)
    router.push('/backend')
  }, [router])

  const handleBackToPipeline = React.useCallback(() => {
    setWonPopupOpen(false)
    setLostPopupOpen(false)
    router.push('/backend/customers/deals/pipeline')
  }, [router])

  const handleScheduleLostFollowUp = React.useCallback(() => {
    if (!data || !defaultActivityEntity) return
    const nextQuarterDate = startOfNextQuarter(new Date())
    setLostPopupOpen(false)
    setScheduleEditData({
      id: '',
      interactionType: 'task',
      title: data.deal.title
        ? t('customers.deals.detail.lost.followUpTitle', 'Revisit {{title}}', { title: data.deal.title })
        : t('customers.deals.detail.lost.followUpFallbackTitle', 'Revisit closed deal'),
      body: data.deal.lossNotes ?? null,
      scheduledAt: nextQuarterDate.toISOString(),
      durationMinutes: 30,
      location: null,
      allDay: false,
      recurrenceRule: null,
      recurrenceEnd: null,
      participants: null,
      reminderMinutes: 1440,
      visibility: 'team',
      linkedEntities: [
        {
          id: data.deal.id,
          type: 'deal',
          label: data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal'),
        },
      ],
    })
    setScheduleDialogOpen(true)
  }, [data, defaultActivityEntity, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.deals.detail.loading', 'Loading deal…')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error || t('customers.deals.detail.error.notFound', 'Deal not found.')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/customers/deals">
                  {t('customers.deals.detail.actions.backToList', 'Back to deals')}
                </Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const amountLabel = formatCurrency(data.deal.valueAmount, data.deal.valueCurrency)
  const currentPipelineName = data.pipelineName ?? wonStats?.pipelineName ?? lostStats?.pipelineName ?? null
  const dealName = data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')

  const zone1Content = (
    <div ref={formWrapperRef}>
      <DealForm
        mode="edit"
        embedded
        hideFooterActions
        singleColumnGroups
        showAssociationsGroup={false}
        showVersionHistory={false}
        showCancelAction={false}
        onDirtyChange={setIsDirty}
        collapsibleGroups={{ pageType: 'deal-detail-v3', chevronPosition: 'left' }}
        sortableGroups={{ pageType: 'deal-detail-v3' }}
        initialValues={{
          ...data.deal,
          valueAmount:
            typeof data.deal.valueAmount === 'string' && data.deal.valueAmount.trim().length
              ? Number(data.deal.valueAmount)
              : null,
          personIds: data.linkedPersonIds,
          companyIds: data.linkedCompanyIds,
          customFields: data.customFields,
          ...Object.fromEntries(Object.entries(data.customFields ?? {}).map(([key, value]) => [`cf_${key}`, value])),
        }}
        onSubmit={handleFormSubmit}
        onCancel={() => { void loadData() }}
        onDelete={handleDelete}
      />
    </div>
  )

  const zone2Content = (
    <div className="rounded-[10px] border border-border bg-card px-5 py-5">
      {(() => {
        const injected = injectedTabMap.get(activeTab)
        if (injected) return injected()

        if (activeTab === 'activities') {
          return (
            <div className="space-y-4">
              {defaultActivityEntity ? (
                <InlineActivityComposer
                  entityType={defaultActivityEntity.kind}
                  entityId={defaultActivityEntity.id}
                  dealId={data.deal.id}
                  onActivityCreated={() => { void handleActivityCreated() }}
                  runGuardedMutation={runMutationWithContext}
                  onScheduleRequested={() => {
                    setScheduleEditData(null)
                    setScheduleDialogOpen(true)
                  }}
                />
              ) : (
                <div className="rounded-[10px] border border-border bg-muted/20 px-5 py-5">
                  <div className="text-sm font-semibold text-foreground">
                    {t('customers.deals.detail.activities.linkEntityTitle', 'Link a person or company first')}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t('customers.deals.detail.activities.linkEntityDescription', 'Activities on a deal still need a customer record for timeline ownership.')}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => handleTabChange('people')}>
                      {t('customers.deals.detail.tabs.people', 'People')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleTabChange('companies')}>
                      {t('customers.deals.detail.tabs.companies', 'Companies')}
                    </Button>
                  </div>
                </div>
              )}
              <PlannedActivitiesSection
                activities={plannedActivities}
                onComplete={(interactionId) => { void handleMarkDone(interactionId) }}
                onSchedule={defaultActivityEntity ? () => {
                  setScheduleEditData(null)
                  setScheduleDialogOpen(true)
                } : undefined}
                onEdit={handleEditActivity}
                onCancel={(interactionId) => { void handleCancelActivity(interactionId) }}
              />
              <ActivitiesSection
                entityId={defaultActivityEntity?.id ?? null}
                entityName={defaultActivityEntity?.label ?? null}
                dealId={data.deal.id}
                dealOptions={dealOptions}
                entityOptions={entityOptions}
                defaultEntityId={defaultActivityEntity?.id ?? null}
                addActionLabel={t('customers.deals.detail.activitiesAdd', 'Log activity')}
                emptyState={{
                  title: t('customers.deals.detail.activitiesEmptyTitle', 'No activities yet'),
                  actionLabel: t('customers.deals.detail.activitiesEmptyAction', 'Log activity'),
                }}
                runGuardedMutation={runMutationWithContext}
                onDataRefresh={() => { void handleActivityCreated() }}
                refreshKey={activityRefreshKey}
                onEditActivity={handleEditActivity}
              />
            </div>
          )
        }

        if (activeTab === 'people') {
          return (
            <DealLinkedEntitiesTab
              entityLabel={t('customers.deals.detail.tabs.peopleSingular', 'Person')}
              entityLabelPlural={t('customers.deals.detail.tabs.people', 'People')}
              manageLabel={t('customers.deals.detail.peopleEditorTitle', 'Manage linked people')}
              searchPlaceholder={t('customers.deals.detail.peopleSearch', 'Search linked people…')}
              linkedItems={data.people}
              linkedCount={data.counts.people}
              selectedIds={peopleEditorIds}
              disabled={peopleSaving || isSaving}
              savePending={peopleSaving}
              hrefBuilder={(personId) => `/backend/customers/people-v2/${encodeURIComponent(personId)}`}
              onSaveSelection={(next) => handlePeopleAssociationsChange(next)}
              loadLinkedPage={loadLinkedPeoplePage}
              searchEntities={searchPeoplePage}
              fetchEntitiesByIds={fetchPeopleByIds}
              icon={<Users className="size-4" />}
            />
          )
        }

        if (activeTab === 'companies') {
          return (
            <DealLinkedEntitiesTab
              entityLabel={t('customers.deals.detail.tabs.companySingular', 'Company')}
              entityLabelPlural={t('customers.deals.detail.tabs.companies', 'Companies')}
              manageLabel={t('customers.deals.detail.companiesEditorTitle', 'Manage linked companies')}
              searchPlaceholder={t('customers.deals.detail.companiesSearch', 'Search linked companies…')}
              linkedItems={data.companies}
              linkedCount={data.counts.companies}
              selectedIds={companiesEditorIds}
              disabled={companiesSaving || isSaving}
              savePending={companiesSaving}
              hrefBuilder={(companyId) => `/backend/customers/companies-v2/${encodeURIComponent(companyId)}`}
              onSaveSelection={(next) => handleCompaniesAssociationsChange(next)}
              loadLinkedPage={loadLinkedCompaniesPage}
              searchEntities={searchCompaniesPage}
              fetchEntitiesByIds={fetchCompaniesByIds}
              icon={<Building2 className="size-4" />}
            />
          )
        }

        if (activeTab === 'notes') {
          return (
            <NotesSection
              entityId={null}
              dealId={data.deal.id}
              dealOptions={dealOptions}
              entityOptions={entityOptions}
              emptyLabel={t('customers.deals.detail.notesEmpty', 'No notes yet.')}
              viewerUserId={data.viewer?.userId ?? null}
              viewerName={data.viewer?.name ?? null}
              viewerEmail={data.viewer?.email ?? null}
              addActionLabel={t('customers.deals.detail.notesAdd', 'Add note')}
              emptyState={{
                title: t('customers.deals.detail.notesEmptyTitle', 'Keep everyone in the loop'),
                actionLabel: t('customers.deals.detail.notesEmptyAction', 'Add a note'),
              }}
              translator={detailTranslator}
              dataAdapter={notesAdapter}
              renderIcon={renderDictionaryIcon}
              renderColor={renderDictionaryColor}
              iconSuggestions={ICON_SUGGESTIONS}
              readMarkdownPreference={readMarkdownPreferenceCookie}
              writeMarkdownPreference={writeMarkdownPreferenceCookie}
            />
          )
        }

        if (activeTab === 'files') {
          return (
            <AttachmentsSection
              entityId={E.customers.customer_deal}
              recordId={data.deal.id}
              title={t('customers.deals.detail.tabs.files', 'Files')}
              description={t('customers.deals.detail.files.subtitle', 'Upload and manage files linked to this deal.')}
            />
          )
        }

        if (activeTab === 'changelog') {
          return <ChangelogTab entityId={data.deal.id} entityType="deal" />
        }

        return null
      })()}
    </div>
  )

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <InjectionSpot spotId="detail:customers.deal:header" context={injectionContext} data={data} />

          <DealDetailHeader
            deal={data.deal}
            owner={data.owner}
            people={data.people}
            companies={data.companies}
            pipelineName={currentPipelineName}
            stageOptions={data.pipelineStages}
            currentStageId={data.deal.pipelineStageId}
            onStageChange={handleStageChange}
            isStageSaving={isStageSaving}
            onSave={handleHeaderSave}
            onDelete={handleDelete}
            isDirty={isDirty}
            isSaving={isSaving}
          />

          <InjectionSpot spotId="detail:customers.deal:status-badges" context={injectionContext} data={data} />

          <PipelineStepper
            stages={data.pipelineStages}
            transitions={data.stageTransitions}
            currentStageId={data.deal.pipelineStageId}
            pipelineName={currentPipelineName}
            closureOutcome={data.deal.closureOutcome}
            footer={data.deal.closureOutcome ? null : (
              <DealClosureActionBar
                embedded
                closureOutcome={data.deal.closureOutcome}
                onWon={() => { void handleWon() }}
                onLost={() => setLostDialogOpen(true)}
              />
            )}
          />

          <DealDetailTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            injectedTabs={injectedTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
            peopleCount={data.counts.people}
            companiesCount={data.counts.companies}
          >
            <CollapsibleZoneLayout
              pageType="deal-detail-v3"
              entityName={dealName}
              isDirty={isDirty}
              zone1DefaultWidth="540px"
              zone1={zone1Content}
              zone2={zone2Content}
            />
          </DealDetailTabs>

          <InjectionSpot spotId="detail:customers.deal:footer" context={injectionContext} data={data} />
        </div>

        {ConfirmDialogElement}

        {defaultActivityEntity ? (
          <ScheduleActivityDialog
            open={scheduleDialogOpen}
            onClose={() => {
              setScheduleDialogOpen(false)
              setScheduleEditData(null)
            }}
            entityId={defaultActivityEntity.id}
            dealId={data.deal.id}
            entityType={defaultActivityEntity.kind}
            entityName={defaultActivityEntity.label}
            companyName={data.companies[0]?.label ?? null}
            onActivityCreated={() => { void handleActivityCreated() }}
            editData={scheduleEditData}
          />
        ) : null}

        <DealLostDialog
          open={lostDialogOpen}
          onClose={() => setLostDialogOpen(false)}
          dealTitle={data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          dealValue={amountLabel}
          companyName={data.companies[0]?.label ?? null}
          onConfirm={handleLostConfirm}
        />

        <DealWonPopup
          open={wonPopupOpen}
          onClose={() => setWonPopupOpen(false)}
          dealTitle={data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          stats={wonStats}
          onViewDashboard={handleViewDashboard}
          onBackToPipeline={handleBackToPipeline}
        />

        <DealLostPopup
          open={lostPopupOpen}
          onClose={() => setLostPopupOpen(false)}
          dealTitle={data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          lossNotes={data.deal.lossNotes}
          stats={lostStats}
          onBackToPipeline={handleBackToPipeline}
          onScheduleFollowUp={defaultActivityEntity ? handleScheduleLostFollowUp : undefined}
        />
      </PageBody>
    </Page>
  )
}
