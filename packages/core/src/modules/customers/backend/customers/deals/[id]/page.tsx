"use client"

import * as React from 'react'
import Link from 'next/link'
import { Building2, Users } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { AttachmentsSection, ErrorMessage, LoadingMessage, NotesSection } from '@open-mercato/ui/backend/detail'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
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
import { DealForm, useDealAssociationLookups } from '../../../../components/detail/DealForm'
import { DealLinkedEntitiesTab } from '../../../../components/detail/DealLinkedEntitiesTab'
import { ConfirmDealLostDialog } from '../../../../components/detail/ConfirmDealLostDialog'
import { DealLostSummaryDialog } from '../../../../components/detail/DealLostSummaryDialog'
import { DealWonPopup } from '../../../../components/detail/DealWonPopup'
import { InlineActivityComposer } from '../../../../components/detail/InlineActivityComposer'
import { PipelineStepper } from '../../../../components/detail/PipelineStepper'
import { PlannedActivitiesSection } from '../../../../components/detail/PlannedActivitiesSection'
import { ScheduleActivityDialog } from '../../../../components/detail/ScheduleActivityDialog'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import type { InteractionSummary } from '../../../../components/detail/types'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

import { formatCurrency, startOfNextQuarter } from './hooks/formatters'
import type { DealDetailPayload } from './hooks/types'
import { useDealActivities } from './hooks/useDealActivities'
import { useDealAssociations } from './hooks/useDealAssociations'
import { useDealClosure } from './hooks/useDealClosure'
import { useDealData } from './hooks/useDealData'
import { useDealFormHandlers } from './hooks/useDealFormHandlers'
import { useDealInjectedTabs } from './hooks/useDealInjectedTabs'
import { useDealMutationContext } from './hooks/useDealMutationContext'
import { useDealPipeline } from './hooks/useDealPipeline'
import { useScheduleDialog } from './hooks/useScheduleDialog'

export default function DealDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? ''
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])

  const { data, setData, isLoading, error, loadData } = useDealData(id)
  const [isDirty, setIsDirty] = React.useState(false)
  const {
    scheduleDialogOpen,
    scheduleEditData,
    openSchedule,
    openEdit: openScheduleEdit,
    closeSchedule,
  } = useScheduleDialog()
  const formWrapperRef = React.useRef<HTMLDivElement>(null)

  const initialTab = React.useMemo(() => resolveLegacyTab(searchParams?.get('tab')), [searchParams])
  const [activeTab, setActiveTab] = React.useState<DealTabId>(initialTab)

  React.useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  const currentDealId = data?.deal.id ?? id
  const { injectionContext, runMutationWithContext } = useDealMutationContext({
    currentDealId,
    fallbackId: id,
    data,
  })

  const notesAdapter = React.useMemo(
    () => createCustomerNotesAdapter(detailTranslator, { runMutation: runMutationWithContext }),
    [detailTranslator, runMutationWithContext],
  )

  const { injectedTabs, injectedTabMap } = useDealInjectedTabs({
    injectionContext,
    data,
    setData,
  })

  const { searchPeoplePage, fetchPeopleByIds, searchCompaniesPage, fetchCompaniesByIds } = useDealAssociationLookups({
    excludeLinkedDealId: data?.deal.id ?? null,
  })

  const {
    plannedActivities,
    activityRefreshKey,
    loadPlannedActivities,
    handleActivityCreated,
    handleMarkDone,
    handleCancelActivity,
  } = useDealActivities({ dealId: id, runMutationWithContext })

  React.useEffect(() => {
    void Promise.all([loadData(), loadPlannedActivities()])
  }, [loadData, loadPlannedActivities])

  const activityEntities = React.useMemo(
    () => (data
      ? [...data.people, ...data.companies].map((entry) => ({
          id: entry.id,
          label: entry.subtitle ? `${entry.label} · ${entry.subtitle}` : entry.label,
          kind: entry.kind,
        }))
      : []),
    [data],
  )
  const [selectedActivityEntityId, setSelectedActivityEntityId] = React.useState<string | null>(null)

  React.useEffect(() => {
    setSelectedActivityEntityId((current) => {
      if (activityEntities.length === 1) return activityEntities[0].id
      if (current && activityEntities.some((entry) => entry.id === current)) return current
      return null
    })
  }, [activityEntities])

  const selectedActivityEntity = React.useMemo(
    () => activityEntities.find((entry) => entry.id === selectedActivityEntityId) ?? null,
    [activityEntities, selectedActivityEntityId],
  )

  const dealOptions = React.useMemo(
    () => data ? [{ id: data.deal.id, label: data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal') }] : [],
    [data, t],
  )

  const entityOptions = React.useMemo(
    () => activityEntities.map(({ id, label }) => ({ id, label })),
    [activityEntities],
  )

  const confirmDiscardIfDirty = React.useCallback(async () => {
    if (!isDirty) return true
    return confirm({
      title: t('customers.deals.detail.unsavedTitle', 'Discard unsaved changes?'),
      description: t(
        'customers.deals.detail.unsavedDescription',
        'You have unsaved edits in this deal. Save them first or continue to discard them.',
      ),
      confirmText: t('customers.deals.detail.unsavedConfirm', 'Discard changes'),
      cancelText: t('customers.deals.detail.unsavedCancel', 'Keep editing'),
      variant: 'destructive',
    })
  }, [confirm, isDirty, t])

  const {
    peopleEditorIds,
    companiesEditorIds,
    peopleSaving,
    companiesSaving,
    handlePeopleAssociationsChange,
    handleCompaniesAssociationsChange,
    loadLinkedPeoplePage,
    loadLinkedCompaniesPage,
  } = useDealAssociations({
    currentDealId,
    data,
    setData,
    runMutationWithContext,
  })

  const { isStageSaving, handleStageChange } = useDealPipeline({
    currentDealId,
    data,
    runMutationWithContext,
    confirmDiscardIfDirty,
    onStageChanged: loadData,
  })

  const {
    lostDialogOpen,
    wonPopupOpen,
    lostPopupOpen,
    wonStats,
    lostStats,
    openLostDialog,
    closeLostDialog,
    closeWonPopup,
    closeLostPopup,
    handleWon,
    handleLostConfirm,
  } = useDealClosure({
    currentDealId,
    runMutationWithContext,
    confirmDiscardIfDirty,
    onClosed: loadData,
  })

  const handleTabChange = React.useCallback(async (tab: DealTabId) => {
    if (!(await confirmDiscardIfDirty())) return
    setActiveTab(tab)
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
    nextParams.set('tab', tab)
    router.replace(`/backend/customers/deals/${encodeURIComponent(id)}?${nextParams.toString()}`, { scroll: false })
  }, [confirmDiscardIfDirty, id, router, searchParams])

  const { isSaving, handleFormSubmit, handleDelete, handleHeaderSave } = useDealFormHandlers({
    data,
    currentDealId,
    loadData,
    runMutationWithContext,
    formWrapperRef,
    confirm,
  })

  const handleEditActivity = React.useCallback((activity: InteractionSummary) => {
    if (activity.entityId && activityEntities.some((entry) => entry.id === activity.entityId)) {
      setSelectedActivityEntityId(activity.entityId)
    }
    openScheduleEdit({
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
      linkedEntities: activity.linkedEntities ?? null,
      guestPermissions: activity.guestPermissions ?? null,
    })
  }, [activityEntities, openScheduleEdit])

  const handleViewDashboard = React.useCallback(() => {
    closeWonPopup()
    router.push('/backend')
  }, [closeWonPopup, router])

  const handleBackToPipeline = React.useCallback(() => {
    closeWonPopup()
    closeLostPopup()
    router.push('/backend/customers/deals/pipeline')
  }, [closeLostPopup, closeWonPopup, router])

  const handleScheduleLostFollowUp = React.useCallback(() => {
    if (!data || !selectedActivityEntity) return
    const nextQuarterDate = startOfNextQuarter(new Date())
    closeLostPopup()
    openScheduleEdit({
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
  }, [closeLostPopup, data, openScheduleEdit, selectedActivityEntity, t])

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
        trackDirtyWhenEmbedded
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
          const activityEntitySelection = activityEntities.length > 1 ? (
            <div className="rounded-[10px] border border-border bg-muted/20 px-5 py-5">
              <label htmlFor="deal-activity-entity" className="text-sm font-semibold text-foreground">
                {t('customers.deals.detail.activities.selectEntityLabel', 'Choose customer record')}
              </label>
              <div className="mt-1 text-sm text-muted-foreground">
                {t(
                  'customers.deals.detail.activities.selectEntityDescription',
                  'Pick the person or company that should own new deal activities and follow-ups.',
                )}
              </div>
              <select
                id="deal-activity-entity"
                aria-label={t('customers.deals.detail.activities.selectEntityLabel', 'Choose customer record')}
                className="mt-4 h-9 w-full rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={selectedActivityEntityId ?? ''}
                onChange={(event) => setSelectedActivityEntityId(event.target.value || null)}
              >
                <option value="">
                  {t('customers.deals.detail.activities.selectEntityPlaceholder', 'Select a person or company')}
                </option>
                {activityEntities.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null

          return (
            <div className="space-y-4">
              {activityEntities.length > 1 ? activityEntitySelection : null}
              {activityEntities.length === 0 ? (
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
              ) : selectedActivityEntity ? (
                <InlineActivityComposer
                  entityType={selectedActivityEntity.kind}
                  entityId={selectedActivityEntity.id}
                  dealId={data.deal.id}
                  onActivityCreated={() => { void handleActivityCreated() }}
                  runGuardedMutation={runMutationWithContext}
                  onScheduleRequested={openSchedule}
                />
              ) : (
                <div className="rounded-[10px] border border-dashed border-border bg-muted/10 px-5 py-5">
                  <div className="text-sm font-semibold text-foreground">
                    {t('customers.deals.detail.activities.selectEntityRequiredTitle', 'Choose a person or company to continue')}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t(
                      'customers.deals.detail.activities.selectEntityRequiredDescription',
                      'Select the customer record that should receive new deal activities before logging or scheduling anything.',
                    )}
                  </div>
                </div>
              )}
              <PlannedActivitiesSection
                activities={plannedActivities}
                onComplete={(interactionId) => { void handleMarkDone(interactionId) }}
                onSchedule={selectedActivityEntity ? openSchedule : undefined}
                onEdit={handleEditActivity}
                onCancel={(interactionId) => { void handleCancelActivity(interactionId) }}
              />
              {selectedActivityEntity ? (
                <ActivitiesSection
                  entityId={selectedActivityEntity.id}
                  entityName={selectedActivityEntity.label}
                  dealId={data.deal.id}
                  dealOptions={dealOptions}
                  entityOptions={entityOptions}
                  defaultEntityId={selectedActivityEntity.id}
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
              ) : null}
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
                onLost={openLostDialog}
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

        {selectedActivityEntity ? (
          <ScheduleActivityDialog
            open={scheduleDialogOpen}
            onClose={closeSchedule}
            entityId={selectedActivityEntity.id}
            dealId={data.deal.id}
            entityType={selectedActivityEntity.kind}
            entityName={selectedActivityEntity.label}
            companyName={selectedActivityEntity.kind === 'company' ? selectedActivityEntity.label : data.companies[0]?.label ?? null}
            onActivityCreated={() => { void handleActivityCreated() }}
            editData={scheduleEditData}
          />
        ) : null}

        <ConfirmDealLostDialog
          open={lostDialogOpen}
          onClose={closeLostDialog}
          dealTitle={data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          dealValue={amountLabel}
          companyName={data.companies[0]?.label ?? null}
          onConfirm={handleLostConfirm}
        />

        <DealWonPopup
          open={wonPopupOpen}
          onClose={closeWonPopup}
          dealTitle={data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          stats={wonStats}
          onViewDashboard={handleViewDashboard}
          onBackToPipeline={handleBackToPipeline}
        />

        <DealLostSummaryDialog
          open={lostPopupOpen}
          onClose={closeLostPopup}
          dealTitle={data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          lossNotes={data.deal.lossNotes}
          stats={lostStats}
          onBackToPipeline={handleBackToPipeline}
          onScheduleFollowUp={selectedActivityEntity ? handleScheduleLostFollowUp : undefined}
        />
      </PageBody>
    </Page>
  )
}
