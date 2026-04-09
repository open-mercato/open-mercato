"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage, type SectionAction } from '@open-mercato/ui/backend/detail'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { CompanyPeopleSection, type CompanyPersonSummary } from '../../../../components/detail/CompanyPeopleSection'
import { InlineActivityComposer } from '../../../../components/detail/InlineActivityComposer'
import { formatTemplate } from '../../../../components/detail/utils'
import type { TagSummary } from '../../../../components/detail/types'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import { CompanyDetailHeader } from '../../../../components/detail/CompanyDetailHeader'
import { CompanyDetailTabs, resolveLegacyTab, type CompanyTabId } from '../../../../components/detail/CompanyDetailTabs'
import { CompanyDashboardTab } from '../../../../components/detail/CompanyDashboardTab'
import { CompanyDataTab } from '../../../../components/detail/CompanyDataTab'
import { TasksSection } from '../../../../components/detail/TasksSection'
import { PlannedActivitiesSection } from '../../../../components/detail/PlannedActivitiesSection'
import { ScheduleActivityDialog } from '../../../../components/detail/ScheduleActivityDialog'
import { ComingSoonPlaceholder } from '../../../../components/detail/ComingSoonPlaceholder'
import { ChangelogTab } from '../../../../components/detail/ChangelogTab'
import type { CompanyOverview } from '../../../../components/formConfig'

export default function CompanyDetailV2Page({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()

  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])

  const [data, setData] = React.useState<CompanyOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Tab state
  const initialTab = React.useMemo(() => {
    return resolveLegacyTab(searchParams?.get('tab'))
  }, [searchParams])
  const [activeTab, setActiveTab] = React.useState<CompanyTabId>(initialTab)
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)

  // Form state lifted from CompanyDataTab
  const [isDirty, setIsDirty] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const formSubmitRef = React.useRef<(() => void) | null>(null)
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)

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

  const companyName =
    data?.company?.displayName && data.company.displayName.trim().length
      ? data.company.displayName
      : t('customers.companies.list.deleteFallbackName', 'this company')

  const translateCompanyDetail = React.useCallback(
    (key: string, fallback?: string, params?: Record<string, string | number>) => {
      const mappedKey = key.startsWith('customers.people.detail.')
        ? key.replace('customers.people.detail.', 'customers.companies.detail.')
        : key
      const adjustedFallback =
        key.startsWith('customers.people.detail.') && fallback
          ? fallback
              .replace(/\bPerson\b/g, 'Company')
              .replace(/\bperson\b/g, 'company')
              .replace(/\bPeople\b/g, 'Companies')
              .replace(/\bpeople\b/g, 'companies')
          : fallback
      const translated = t(mappedKey, params)
      if (translated !== mappedKey || mappedKey === key) return translated
      const fallbackValue = t(key, params)
      if (fallbackValue !== key) return fallbackValue
      if (!adjustedFallback) return mappedKey
      return formatTemplate(adjustedFallback, params)
    },
    [t],
  )

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
      const search = new URLSearchParams()
      search.append('include', 'todos')
      search.append('include', 'people')
      search.append('include', 'interactions')
      const payload = await readApiResultOrThrow<CompanyOverview>(
        `/api/customers/companies/${encodeURIComponent(id)}?${search.toString()}`,
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
    loadData().catch(() => {})
  }, [loadData])

  const handleActivityCreated = React.useCallback(() => {
    setActivityRefreshKey((k) => k + 1)
    loadData().catch(() => {})
  }, [loadData])

  // Planned activities for the activity-log tab
  const plannedActivities = React.useMemo(() => {
    const interactions = data?.interactions ?? []
    return interactions.filter((i) => i.status === 'planned' && i.interactionType !== 'task')
  }, [data?.interactions])

  const handleMarkDone = React.useCallback(async (interactionId: string) => {
    try {
      await apiCallOrThrow(`/api/customers/interactions?id=${encodeURIComponent(interactionId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done', occurredAt: new Date().toISOString() }),
      })
      flash(t('customers.timeline.planned.completed', 'Activity completed'), 'success')
      handleActivityCreated()
    } catch {
      flash(t('customers.timeline.planned.error', 'Failed to complete activity'), 'error')
    }
  }, [handleActivityCreated, t])

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
    setSectionAction(action)
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
    await deleteCrud('customers/companies', { id: data?.company?.id ?? '' })
    flash(t('customers.companies.list.deleteSuccess', 'Company deleted.'), 'success')
    router.push('/backend/customers/companies')
  }, [data?.company?.id, router, t])

  // Save handler (triggers form submit via ref)
  const handleHeaderSave = React.useCallback(() => {
    formSubmitRef.current?.()
  }, [])

  const handleSubmitRefReady = React.useCallback((fn: () => void) => {
    formSubmitRef.current = fn
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
            activeTab={activeTab}
          />

          {/* Full-width tab navigation + content */}
          <CompanyDetailTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            injectedTabs={injectedTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
            peopleCount={data.people?.length ?? 0}
            dealsCount={data.deals?.length ?? 0}
            activitiesCount={data.interactions?.length ?? 0}
          >
            {activeTab === 'dashboard' && (
              <CompanyDashboardTab
                data={data}
                companyId={companyId}
                onTabChange={setActiveTab}
                onActivityCreated={handleActivityCreated}
                onScheduleRequested={() => setScheduleDialogOpen(true)}
                runGuardedMutation={runMutationWithContext}
                useCanonicalInteractions={useCanonicalInteractions}
              />
            )}

            {activeTab === 'dane-firmy' && (
              <CompanyDataTab
                data={data}
                onDataRefresh={loadData}
                onSubmitRefReady={handleSubmitRefReady}
                onDirtyChange={setIsDirty}
                onSavingChange={setIsSaving}
                zone2={
                  <>
                    <DealsSection
                      scope={dealsScope}
                      emptyLabel={translateCompanyDetail('customers.companies.detail.empty.deals', 'No deals linked to this company.')}
                      addActionLabel={translateCompanyDetail('customers.companies.detail.actions.addDeal', 'Add deal')}
                      emptyState={{
                        title: translateCompanyDetail('customers.companies.detail.emptyState.deals.title', 'No active deals'),
                        actionLabel: translateCompanyDetail('customers.companies.detail.emptyState.deals.action', 'Create a deal'),
                      }}
                      onActionChange={handleSectionActionChange}
                      translator={detailTranslator}
                    />
                    <TasksSection
                      entityId={companyId}
                      initialTasks={data.todos}
                      useCanonicalInteractions={useCanonicalInteractions}
                      runGuardedMutation={runMutationWithContext}
                      onDataRefresh={loadData}
                      emptyLabel={translateCompanyDetail('customers.companies.detail.empty.todos', 'No tasks linked to this company.')}
                      addActionLabel={translateCompanyDetail('customers.companies.detail.tasks.add', 'Add task')}
                      emptyState={{
                        title: translateCompanyDetail('customers.companies.detail.emptyState.tasks.title', 'Plan what happens next'),
                        actionLabel: translateCompanyDetail('customers.companies.detail.emptyState.tasks.action', 'Create task'),
                      }}
                      onActionChange={handleSectionActionChange}
                      translator={detailTranslator}
                      entityName={companyName}
                      dialogContextKey="customers.companies.detail.tasks.dialog.context"
                      dialogContextFallback="This task will be linked to {{name}}"
                    />
                    <InlineActivityComposer
                      entityType="company"
                      entityId={companyId}
                      onActivityCreated={handleActivityCreated}
                      runGuardedMutation={runMutationWithContext}
                      onScheduleRequested={() => setScheduleDialogOpen(true)}
                      useCanonicalInteractions={useCanonicalInteractions}
                    />
                    <ActivitiesSection
                      entityId={companyId}
                      entityName={companyName}
                      useCanonicalInteractions={useCanonicalInteractions}
                      runGuardedMutation={runMutationWithContext}
                      onDataRefresh={handleActivityCreated}
                      refreshKey={activityRefreshKey}
                      addActionLabel={translateCompanyDetail('customers.companies.detail.activities.add', 'Log activity')}
                      emptyState={{
                        title: translateCompanyDetail('customers.companies.detail.emptyState.activities.title', 'No recent activity'),
                        actionLabel: translateCompanyDetail('customers.companies.detail.emptyState.activities.action', 'Log activity'),
                      }}
                      onActionChange={handleSectionActionChange}
                      onLoadingChange={() => {}}
                    />
                  </>
                }
              />
            )}

            {activeTab === 'people' && (
              <CompanyPeopleSection
                companyId={companyId}
                companyName={data.company?.displayName ?? ''}
                initialPeople={data.people ?? []}
                addActionLabel={t('customers.companies.detail.people.add', 'Add person')}
                emptyLabel={t('customers.companies.detail.people.empty', 'No people linked to this company yet.')}
                emptyState={{
                  title: t('customers.companies.detail.emptyState.people.title', 'Build the account team'),
                  actionLabel: t('customers.companies.detail.emptyState.people.action', 'Create person'),
                }}
                onActionChange={handleSectionActionChange}
                translator={detailTranslator}
                onDataRefresh={loadData}
                runGuardedMutation={runMutationWithContext}
                onPeopleChange={(next) => {
                  setData((prev) => (prev ? { ...prev, people: next } : prev))
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
              />
            )}

            {activeTab === 'activity-log' && (
              <div className="space-y-4">
                <InlineActivityComposer
                  entityType="company"
                  entityId={companyId}
                  onActivityCreated={handleActivityCreated}
                  runGuardedMutation={runMutationWithContext}
                  onScheduleRequested={() => setScheduleDialogOpen(true)}
                  useCanonicalInteractions={useCanonicalInteractions}
                />
                <PlannedActivitiesSection
                  activities={plannedActivities}
                  onComplete={handleMarkDone}
                  onSchedule={() => setScheduleDialogOpen(true)}
                />
                <ActivitiesSection
                  entityId={companyId}
                  entityName={companyName}
                  useCanonicalInteractions={useCanonicalInteractions}
                  runGuardedMutation={runMutationWithContext}
                  onDataRefresh={handleActivityCreated}
                  refreshKey={activityRefreshKey}
                  addActionLabel={t('customers.companies.detail.activities.add', 'Log activity')}
                  emptyState={{
                    title: t('customers.companies.detail.emptyState.activities.title', 'No activities logged yet'),
                    actionLabel: t('customers.companies.detail.emptyState.activities.action', 'Log activity'),
                  }}
                  onActionChange={handleSectionActionChange}
                  onLoadingChange={() => {}}
                />
              </div>
            )}

            {activeTab === 'analysis' && (
              <ComingSoonPlaceholder label={t('customers.companies.detail.tabs.analysis', 'Analiza')} />
            )}

            {activeTab === 'changelog' && companyId && (
              <ChangelogTab entityId={companyId} entityType="company" />
            )}

            {activeTab === 'files' && (
              <ComingSoonPlaceholder label={t('customers.companies.detail.tabs.files', 'Pliki')} />
            )}

            {/* Injected tabs from UMES */}
            {injectedTabMap.has(activeTab) && injectedTabMap.get(activeTab)!()}
          </CompanyDetailTabs>

          {/* UMES footer injection */}
          <InjectionSpot spotId="detail:customers.company:footer" context={injectionContext} data={data} />

          {/* Schedule Activity Dialog */}
          <ScheduleActivityDialog
            open={scheduleDialogOpen}
            onClose={() => setScheduleDialogOpen(false)}
            entityId={companyId}
            entityName={companyName}
            entityType="company"
            onActivityCreated={handleActivityCreated}
          />
        </div>
      </PageBody>
    </Page>
  )
}
