"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Building2, Hash, Users, BarChart3, StickyNote } from 'lucide-react'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { AttachmentsSection, ErrorMessage, LoadingMessage, type SectionAction } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { CollapsibleZoneLayout, type ZoneSectionDescriptor } from '@open-mercato/ui/backend/crud/CollapsibleZoneLayout'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { ActivityLogTab } from '../../../../components/detail/ActivityLogTab'
import { CompanyPeopleSection, type CompanyPersonSummary } from '../../../../components/detail/CompanyPeopleSection'
import type { TagSummary } from '../../../../components/detail/types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import { coerceDisplayName } from '../../../../lib/displayName'
import { CompanyDetailHeader } from '../../../../components/detail/CompanyDetailHeader'
import { CompanyDetailTabs, resolveLegacyTab, type CompanyTabId } from '../../../../components/detail/CompanyDetailTabs'
import { CompanyKpiBar } from '../../../../components/detail/CompanyKpiBar'
import { ScheduleActivityDialog, type ScheduleActivityEditData } from '../../../../components/detail/ScheduleActivityDialog'
import { ChangelogTab } from '../../../../components/detail/ChangelogTab'
import { useInteractionMutations } from '../../../../components/detail/hooks/useInteractionMutations'
import {
  buildCompanyEditPayload,
  createCompanyEditFields,
  createCompanyDaneFiremyGroups,
  createCompanyEditSchema,
  mapCompanyOverviewToFormValues,
  type CompanyEditFormValues,
  type CompanyOverview,
} from '../../../../components/formConfig'

export default function CompanyDetailV2Page({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])

  const [data, setData] = React.useState<CompanyOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Tab state
  const initialTab = React.useMemo(() => {
    return resolveLegacyTab(searchParams?.get('tab'))
  }, [searchParams])
  const [activeTab, setActiveTab] = React.useState<CompanyTabId>(initialTab)
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)

  // Form state
  const [isDirty, setIsDirty] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const formWrapperRef = React.useRef<HTMLDivElement>(null)
  const { organizationId } = useOrganizationScopeDetail()
  const formSchema = React.useMemo(() => createCompanyEditSchema(), [])
  const formFields = React.useMemo(() => createCompanyEditFields(t), [t])
  const formGroups = React.useMemo(() => createCompanyDaneFiremyGroups(t), [t])
  const initialValues = React.useMemo(
    () => (data ? mapCompanyOverviewToFormValues(data) : undefined),
    [data],
  )
  const zoneSections = React.useMemo<ZoneSectionDescriptor[]>(() => [
    { id: 'identity', icon: Building2, label: t('customers.companies.form.sections.identity', 'Identity') },
    { id: 'contact', icon: Hash, label: t('customers.companies.form.sections.contact', 'Contact') },
    { id: 'classification', icon: Users, label: t('customers.companies.form.sections.classification', 'Classification') },
    { id: 'businessProfile', icon: BarChart3, label: t('customers.companies.form.sections.businessProfile', 'Business profile') },
    { id: 'notes', icon: StickyNote, label: t('customers.companies.form.groups.notes', 'Notes') },
    { id: 'customFields', icon: Hash, label: t('customers.companies.form.groups.customAttributes', 'Custom attributes') },
  ], [t])
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleEditData, setScheduleEditData] = React.useState<ScheduleActivityEditData | null>(null)
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)
  const [dealCount, setDealCount] = React.useState(0)

  const currentCompanyId = data?.company?.id ?? null
  const mutationContextId = React.useMemo(
    () => (currentCompanyId ? `customer-company:${currentCompanyId}` : `customer-company:${id ?? 'pending'}`),
    [currentCompanyId, id],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    companyId?: string | null
    resourceKind: string
    resourceId?: string
    data: CompanyOverview | null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const companyDisplayName = coerceDisplayName(data?.company?.displayName)
  const companyName = companyDisplayName.trim().length
    ? companyDisplayName
    : t('customers.companies.list.deleteFallbackName', 'this company')

  // Data loading
  const initialLoadDoneRef = React.useRef(false)
  const loadData = React.useCallback(async () => {
    if (!id) {
      setError(t('customers.companies.detail.error.notFound', 'Company not found.'))
      setIsLoading(false)
      return
    }
    if (!initialLoadDoneRef.current) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const payload = await readApiResultOrThrow<CompanyOverview>(
        `/api/customers/companies/${encodeURIComponent(id)}`,
        undefined,
        { errorMessage: t('customers.companies.detail.error.load', 'Failed to load company.') },
      )
      setData(payload as CompanyOverview)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.detail.error.load', 'Failed to load company.')
      setError(message)
      if (!initialLoadDoneRef.current) setData(null)
    } finally {
      setIsLoading(false)
      initialLoadDoneRef.current = true
    }
  }, [id, t])

  React.useEffect(() => {
    loadData().catch((err) => console.warn('[companies-v2] loadData failed', err))
  }, [loadData])

  React.useEffect(() => {
    setDealCount(data?.counts?.deals ?? 0)
  }, [data?.counts?.deals])

  const handleActivityCreated = React.useCallback(() => {
    setActivityRefreshKey((k) => k + 1)
    loadData().catch((err) => console.warn('[companies-v2] reload after activity failed', err))
  }, [loadData])

  // Planned activities for the activity-log tab
  const plannedActivities = React.useMemo(() => {
    return data?.plannedActivitiesPreview ?? []
  }, [data?.plannedActivitiesPreview])

  // Injection context for UMES
  const injectionContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      companyId: currentCompanyId,
      resourceKind: 'customers.company',
      resourceId: currentCompanyId ?? (id ?? undefined),
      data,
      retryLastMutation,
    }),
    [currentCompanyId, data, id, mutationContextId, retryLastMutation],
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

  const { completeInteraction: handleMarkDone, cancelInteraction: handleCancelActivity } = useInteractionMutations({
    runMutationWithContext,
    onAfterChange: handleActivityCreated,
    logContext: 'customers.companies-v2',
  })

  const handleEditActivity = React.useCallback((activity: { id: string; interactionType?: string; title?: string | null; body?: string | null; scheduledAt?: string | null; occurredAt?: string | null; [key: string]: unknown }) => {
    const raw = activity as Record<string, unknown>
    const durationValue = typeof raw.duration === 'number'
      ? raw.duration
      : typeof raw.durationMinutes === 'number'
        ? raw.durationMinutes as number
        : null
    // Forward `customValues` so per-type chip state (callPhoneNumber, callDirection,
    // taskPriority, …) round-trips on edit (#1808 phone persistence).
    // Forward `occurredAt` so historical activity edits prefill from the original
    // moment instead of "today" (#1807 prefill).
    const editPayload = {
      id: activity.id,
      interactionType: typeof activity.interactionType === 'string' ? activity.interactionType : undefined,
      title: typeof activity.title === 'string' ? activity.title : null,
      body: typeof activity.body === 'string' ? activity.body : null,
      scheduledAt: typeof activity.scheduledAt === 'string' ? activity.scheduledAt : null,
      occurredAt: typeof activity.occurredAt === 'string' ? activity.occurredAt : null,
      durationMinutes: durationValue,
      location: typeof raw.location === 'string' ? raw.location as string : null,
      allDay: typeof raw.allDay === 'boolean' ? raw.allDay as boolean : null,
      recurrenceRule: typeof raw.recurrenceRule === 'string' ? raw.recurrenceRule as string : null,
      recurrenceEnd: typeof raw.recurrenceEnd === 'string' ? raw.recurrenceEnd as string : null,
      participants: Array.isArray(raw.participants) ? raw.participants as ScheduleActivityEditData['participants'] : null,
      reminderMinutes: typeof raw.reminderMinutes === 'number' ? raw.reminderMinutes as number : null,
      visibility: typeof raw.visibility === 'string' ? raw.visibility as string : null,
      linkedEntities: Array.isArray(raw.linkedEntities) ? raw.linkedEntities as ScheduleActivityEditData['linkedEntities'] : null,
      guestPermissions: raw.guestPermissions && typeof raw.guestPermissions === 'object'
        ? raw.guestPermissions as ScheduleActivityEditData['guestPermissions']
        : null,
      customValues: raw.customValues && typeof raw.customValues === 'object'
        ? raw.customValues as Record<string, unknown>
        : null,
      phoneNumber: typeof raw.phoneNumber === 'string' ? raw.phoneNumber as string : null,
    } as ScheduleActivityEditData & { customValues?: Record<string, unknown> | null; phoneNumber?: string | null }
    setScheduleEditData(editPayload)
    setScheduleDialogOpen(true)
  }, [])

  const openNewScheduleDialog = React.useCallback(() => {
    setScheduleEditData(null)
    setScheduleDialogOpen(true)
  }, [])

  const handleAddActivity = React.useCallback((kind: 'meeting' | 'call' | 'task' | 'email') => {
    setScheduleEditData({
      id: '',
      interactionType: kind,
      title: null,
      body: null,
      scheduledAt: null,
      durationMinutes: null,
      location: null,
      allDay: null,
      recurrenceRule: null,
      recurrenceEnd: null,
      participants: null,
      reminderMinutes: null,
      visibility: null,
      linkedEntities: null,
      guestPermissions: null,
    })
    setScheduleDialogOpen(true)
  }, [])

  // Injected tabs from UMES
  const { widgets: injectedTabWidgets } = useInjectionWidgets('detail:customers.company:tabs', {
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
              onDataChange={(next: unknown) => setData(next as CompanyOverview)}
            />
          )
          return { id: tabId, label, priority, render }
        })
        .sort((a, b) => b.priority - a.priority),
    [data, injectedTabWidgets, injectionContext],
  )

  const injectedTabMap = React.useMemo(() => new Map(injectedTabs.map((tab) => [tab.id, tab.render])), [injectedTabs])

  // Tags
  const handleTagsChange = React.useCallback((nextTags: TagSummary[]) => {
    setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
  }, [])
  const tagsSectionControllerRef = React.useRef<TagsSectionController | null>(null)

  // Section action (for tabs that expose add/create buttons)
  const handleSectionActionChange = React.useCallback((action: SectionAction | null) => {
    setSectionAction((prev) => (action !== null ? action : prev))
  }, [])

  const handleSectionAction = React.useCallback(() => {
    if (!sectionAction || sectionAction.disabled) return
    sectionAction.onClick()
  }, [sectionAction])

  React.useEffect(() => {
    setSectionAction(null)
  }, [activeTab])

  // Deals scope
  const dealsScope = React.useMemo(
    () => (currentCompanyId ? ({ kind: 'company', entityId: currentCompanyId } as const) : null),
    [currentCompanyId],
  )

  // Delete handler (shared between header and form)
  const handleDelete = React.useCallback(async () => {
    const companyId = data?.company?.id ?? ''
    if (!companyId) return
    const approved = await confirm({
      title: t('customers.companies.detail.deleteConfirmTitle', 'Delete company?'),
      description: t('customers.companies.detail.deleteConfirmDescription', 'This action cannot be undone.'),
      confirmText: t('customers.companies.detail.actions.delete', 'Delete company'),
      cancelText: t('customers.companies.detail.actions.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!approved) return
    await runMutationWithContext(
      () => deleteCrud('customers/companies', { id: companyId }),
      { id: companyId, operation: 'deleteCompany' },
    )
    flash(t('customers.companies.list.deleteSuccess', 'Company deleted.'), 'success')
    router.push('/backend/customers/companies')
  }, [confirm, data?.company?.id, router, runMutationWithContext, t])

  // Form submit handler (lifted from CompanyDataTab)
  const handleFormSubmit = React.useCallback(
    async (values: CompanyEditFormValues) => {
      setIsSaving(true)
      try {
        let payload: Record<string, unknown>
        try {
          payload = buildCompanyEditPayload(values, organizationId)
        } catch (err) {
          if (err instanceof Error) {
            if (err.message === 'DISPLAY_NAME_REQUIRED') {
              const message = t('customers.companies.form.displayName.error')
              throw createCrudFormError(message, { displayName: message })
            }
            if (err.message === 'ANNUAL_REVENUE_INVALID') {
              const message = t('customers.companies.form.annualRevenue.error')
              throw createCrudFormError(message, { annualRevenue: message })
            }
          }
          throw err
        }
        await updateCrud('customers/companies', payload)
        flash(t('customers.companies.form.updateSuccess', 'Company updated.'), 'success')
        await loadData()
      } finally {
        setIsSaving(false)
      }
    },
    [loadData, organizationId, t],
  )

  // Save handler (triggers form submit via ref)
  const handleHeaderSave = React.useCallback(() => {
    const form = formWrapperRef.current?.querySelector('form')
    if (form) form.requestSubmit()
  }, [])

  // Loading / error states
  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.companies.detail.loading', 'Loading company…')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !data?.company?.id) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error || t('customers.companies.detail.error.notFound', 'Company not found.')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/customers/companies">
                  {t('customers.companies.detail.actions.backToList', 'Back to companies')}
                </Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const companyId = data.company.id
  const useCanonicalInteractions = data.interactionMode === 'canonical'

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          {/* UMES header injection */}
          <InjectionSpot spotId="detail:customers.company:header" context={injectionContext} data={data} />
          <InjectionSpot spotId="detail:customers.company:status-badges" context={injectionContext} data={data} />

          {/* Persistent company header */}
          <CompanyDetailHeader
            data={data}
            onTagsChange={handleTagsChange}
            tagsSectionControllerRef={tagsSectionControllerRef}
            onSave={handleHeaderSave}
            onDelete={handleDelete}
            isDirty={isDirty}
            isSaving={isSaving}
            onDataReload={() => { loadData().catch((err) => console.warn('[companies-v2] onDataReload failed', err)) }}
          />

          {/* KPI bar — always visible above zones */}
          <CompanyKpiBar data={data} />

          {/* Two-zone layout: zone1 = form, zone2 = tabs */}
          <CollapsibleZoneLayout
            pageType="company-v2"
            entityName={companyName}
            isDirty={isDirty}
            sections={zoneSections}
            zone1={
              <div ref={formWrapperRef}>
                <CrudForm<CompanyEditFormValues>
                  embedded
                  trackDirtyWhenEmbedded
                  injectionSpotId="customers.company"
                  entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
                  schema={formSchema}
                  fields={formFields}
                  groups={formGroups}
                  initialValues={initialValues}
                  onSubmit={handleFormSubmit}
                  onDelete={handleDelete}
                  hideFooterActions
                  collapsibleGroups={{ pageType: 'company-v2', chevronPosition: 'right' }}
                  sortableGroups={{ pageType: 'company-v2' }}
                  onDirtyChange={setIsDirty}
                />
              </div>
            }
            zone2={
              <CompanyDetailTabs
                activeTab={activeTab}
                onTabChange={setActiveTab}
                injectedTabs={injectedTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
                peopleCount={data.counts?.people ?? 0}
                dealsCount={dealCount}
                activitiesCount={data.counts?.activities ?? 0}
                sectionAction={sectionAction}
              >
                {activeTab === 'people' && (
                  <CompanyPeopleSection
                    companyId={companyId}
                    companyName={companyDisplayName}
                    initialPeople={[]}
                    addActionLabel={t('customers.companies.detail.people.add', 'Add person')}
                    emptyLabel={t('customers.companies.detail.people.empty', 'No people linked to this company yet.')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.people.title', 'Build the account team'),
                      actionLabel: t('customers.companies.detail.emptyState.people.action', 'Create person'),
                    }}
                    onActionChange={handleSectionActionChange}
                    translator={detailTranslator}
                    runGuardedMutation={runMutationWithContext}
                    onPeopleChange={(next) => {
                      setData((prev) => {
                        if (!prev) return prev
                        const nextCount = next.length
                        return {
                          ...prev,
                          people: next,
                          counts: prev.counts ? { ...prev.counts, people: nextCount } : prev.counts,
                        }
                      })
                    }}
                  />
                )}

                {activeTab === 'deals' && (
                  <DealsSection
                    scope={dealsScope}
                    emptyLabel={t('customers.companies.detail.empty.deals', 'No deals linked to this company.')}
                    addActionLabel={t('customers.companies.detail.actions.addDeal', 'Add deal')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.deals.title', 'No deals yet'),
                      actionLabel: t('customers.companies.detail.emptyState.deals.action', 'Create a deal'),
                    }}
                    onActionChange={handleSectionActionChange}
                    translator={detailTranslator}
                    runGuardedMutation={runMutationWithContext}
                    onCountDelta={(delta) => setDealCount((current) => Math.max(0, current + delta))}
                  />
                )}

                {activeTab === 'activity-log' && (
                  <ActivityLogTab
                    entityId={companyId}
                    plannedActivities={plannedActivities}
                    onActivityCreated={handleActivityCreated}
                    onScheduleRequested={openNewScheduleDialog}
                    onAddActivity={handleAddActivity}
                    onMarkDone={handleMarkDone}
                    onEditActivity={handleEditActivity}
                    onCancelActivity={handleCancelActivity}
                    runGuardedMutation={runMutationWithContext}
                    refreshKey={activityRefreshKey}
                    useCanonicalInteractions={useCanonicalInteractions}
                  />
                )}

                {activeTab === 'changelog' && companyId && (
                  <ChangelogTab entityId={companyId} entityType="company" />
                )}

                {activeTab === 'files' && (
                  <AttachmentsSection
                    entityId={E.customers.customer_entity}
                    recordId={companyId}
                    title={t('customers.companies.detail.tabs.files', 'Files')}
                    description={t('customers.companies.detail.files.subtitle', 'Upload and manage files linked to this company.')}
                  />
                )}

                {/* Injected tabs from UMES */}
                {injectedTabMap.has(activeTab) && injectedTabMap.get(activeTab)!()}
              </CompanyDetailTabs>
            }
          />

          {/* UMES footer injection */}
          <InjectionSpot spotId="detail:customers.company:footer" context={injectionContext} data={data} />

          {/* Schedule Activity Dialog */}
          <ScheduleActivityDialog
            open={scheduleDialogOpen}
            onClose={() => { setScheduleDialogOpen(false); setScheduleEditData(null) }}
            entityId={companyId}
            entityName={companyName}
            entityType="company"
            onActivityCreated={handleActivityCreated}
            editData={scheduleEditData}
          />
          {ConfirmDialogElement}
        </div>
      </PageBody>
    </Page>
  )
}
