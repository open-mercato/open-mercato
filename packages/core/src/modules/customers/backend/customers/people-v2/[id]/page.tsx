"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { User, Hash, Users, Building2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { CollapsibleZoneLayout, type ZoneSectionDescriptor } from '@open-mercato/ui/backend/crud/CollapsibleZoneLayout'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Button } from '@open-mercato/ui/primitives/button'
import { AttachmentsSection, ErrorMessage, LoadingMessage, type SectionAction } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'

import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { ActivitiesCard } from '../../../../components/detail/ActivitiesCard'
import type { ActivityKind } from '../../../../components/detail/ActivitiesAddNewMenu'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { TasksSection } from '../../../../components/detail/TasksSection'
import type { TagSummary } from '../../../../components/detail/types'
import { ScheduleActivityDialog, type ScheduleActivityEditData } from '../../../../components/detail/ScheduleActivityDialog'
import { PersonDetailHeader } from '../../../../components/detail/PersonDetailHeader'
import { ChangelogTab } from '../../../../components/detail/ChangelogTab'
import { PersonDetailTabs, resolveLegacyTab, type PersonTabId } from '../../../../components/detail/PersonDetailTabs'
import { PersonCompaniesSection } from '../../../../components/detail/PersonCompaniesSection'
import { MobilePersonDetail } from '../../../../components/detail/MobilePersonDetail'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import {
  buildPersonEditPayload,
  createPersonEditFields,
  createPersonPersonalDataGroups,
  createPersonEditSchema,
  mapPersonOverviewToFormValues,
  type PersonEditFormValues,
  type PersonOverview,
} from '../../../../components/formConfig'
import { coerceDisplayName, coerceDisplayNameOrNull } from '../../../../lib/displayName'

export default function PersonDetailV2Page({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { organizationId } = useOrganizationScopeDetail()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])


  const formSchema = React.useMemo(() => createPersonEditSchema(), [])
  const fields = React.useMemo(() => createPersonEditFields(t), [t])

  const [data, setData] = React.useState<PersonOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Form state lifted for header Save button
  const [isDirty, setIsDirty] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const formWrapperRef = React.useRef<HTMLDivElement>(null)

  const initialTab = React.useMemo(() => {
    return resolveLegacyTab(searchParams?.get('tab'))
  }, [searchParams])
  const [activeTab, setActiveTab] = React.useState<PersonTabId>(initialTab)
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false)
  const [scheduleEditData, setScheduleEditData] = React.useState<ScheduleActivityEditData | null>(null)
  const [activityRefreshKey, setActivityRefreshKey] = React.useState(0)
  const [dealCount, setDealCount] = React.useState(0)

  const currentPersonId = data?.person?.id ?? null
  const mutationContextId = React.useMemo(
    () => (currentPersonId ? `customer-person:${currentPersonId}` : `customer-person:${id ?? 'pending'}`),
    [currentPersonId, id],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    personId?: string | null
    resourceKind: string
    resourceId?: string
    data: PersonOverview | null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const personDisplayName = coerceDisplayName(data?.person?.displayName)
  const personName = personDisplayName.trim().length
    ? personDisplayName
    : t('customers.people.list.deleteFallbackName', 'this person')

  const personDisplayNameForGroups = personDisplayName.trim().length
    ? personDisplayName.trim()
    : null

  const scheduleDialogCompanyName = coerceDisplayNameOrNull(
    data?.company?.displayName ?? data?.companies?.[0]?.displayName ?? null,
  )

  const groups = React.useMemo(
    () => createPersonPersonalDataGroups(t, { entityName: personDisplayNameForGroups }),
    [t, personDisplayNameForGroups],
  )

  const zoneSections = React.useMemo<ZoneSectionDescriptor[]>(() => [
    { id: 'personalData', icon: User, label: t('customers.people.form.groups.personalData', 'Personal data') },
    { id: 'companyRole', icon: Building2, label: t('customers.people.form.groups.companyRole', 'Company & role') },
    { id: 'customFields', icon: Hash, label: t('customers.people.form.groups.customAttributes', 'Custom attributes') },
    { id: 'roles', icon: Users, label: t('customers.people.form.groups.roles', 'My roles') },
  ], [t])

  // Data loading
  const initialLoadDoneRef = React.useRef(false)
  const loadData = React.useCallback(async () => {
    if (!id) {
      setError(t('customers.people.detail.error.notFound', 'Person not found.'))
      setIsLoading(false)
      return
    }
    if (!initialLoadDoneRef.current) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const payload = await readApiResultOrThrow<PersonOverview>(
        `/api/customers/people/${encodeURIComponent(id)}`,
        undefined,
        { errorMessage: t('customers.people.detail.error.load', 'Failed to load person.') },
      )
      setData(payload as PersonOverview)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.error.load', 'Failed to load person.')
      setError(message)
      if (!initialLoadDoneRef.current) setData(null)
    } finally {
      setIsLoading(false)
      initialLoadDoneRef.current = true
    }
  }, [id, t])

  React.useEffect(() => {
    loadData().catch((err) => console.warn('[people-v2] loadData failed', err))
  }, [loadData])

  React.useEffect(() => {
    setDealCount(data?.counts?.deals ?? 0)
  }, [data?.counts?.deals])

  const handleActivityCreated = React.useCallback(() => {
    setActivityRefreshKey((k) => k + 1)
    loadData().catch((err) => console.warn('[people-v2] reload after activity failed', err))
  }, [loadData])

  const plannedActivities = React.useMemo(() => {
    return data?.plannedActivitiesPreview ?? []
  }, [data?.plannedActivitiesPreview])

  // Injection context for UMES
  const injectionContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      personId: currentPersonId,
      resourceKind: 'customers.person',
      resourceId: currentPersonId ?? (id ?? undefined),
      data,
      retryLastMutation,
    }),
    [currentPersonId, data, id, mutationContextId, retryLastMutation],
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

  const handleAddActivity = React.useCallback((kind: ActivityKind) => {
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

  const handleEditActivity = React.useCallback((activity: { id: string; interactionType?: string; title?: string | null; body?: string | null; scheduledAt?: string | null; [key: string]: unknown }) => {
    const raw = activity as Record<string, unknown>
    const durationValue = typeof raw.duration === 'number'
      ? raw.duration
      : typeof raw.durationMinutes === 'number'
        ? raw.durationMinutes as number
        : null
    setScheduleEditData({
      id: activity.id,
      interactionType: typeof activity.interactionType === 'string' ? activity.interactionType : undefined,
      title: typeof activity.title === 'string' ? activity.title : null,
      body: typeof activity.body === 'string' ? activity.body : null,
      scheduledAt: typeof activity.scheduledAt === 'string' ? activity.scheduledAt : null,
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
    })
    setScheduleDialogOpen(true)
  }, [])

  // Injected tabs from UMES
  const { widgets: injectedTabWidgets } = useInjectionWidgets('detail:customers.person:tabs', {
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
              onDataChange={(next: unknown) => setData(next as PersonOverview)}
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

  React.useEffect(() => {
    setSectionAction(null)
  }, [activeTab])

  // Deals scope
  const dealsScope = React.useMemo(
    () => (currentPersonId ? ({ kind: 'person', entityId: currentPersonId } as const) : null),
    [currentPersonId],
  )

  const initialValues = React.useMemo(
    () => (data ? mapPersonOverviewToFormValues(data) : undefined),
    [data],
  )

  // Form submit/delete
  const handleFormSubmit = React.useCallback(
    async (values: PersonEditFormValues) => {
      setIsSaving(true)
      try {
        await tagsSectionControllerRef.current?.flush()

        let payload: Record<string, unknown>
        try {
          payload = buildPersonEditPayload(values, organizationId)
        } catch (err) {
          if (err instanceof Error && err.message === 'DISPLAY_NAME_REQUIRED') {
            const message = t('customers.people.form.displayName.error')
            throw createCrudFormError(message, { displayName: message })
          }
          throw err
        }

        await updateCrud('customers/people', payload)
        flash(t('customers.people.form.updateSuccess', 'Person updated.'), 'success')
        await loadData()
      } finally {
        setIsSaving(false)
      }
    },
    [loadData, organizationId, t],
  )

  const handleFormDelete = React.useCallback(
    async () => {
      const personId = data?.person?.id ?? ''
      if (!personId) return
      const approved = await confirm({
        title: t('customers.people.detail.deleteConfirmTitle', 'Delete person?'),
        description: t('customers.people.detail.deleteConfirmDescription', 'This action cannot be undone.'),
        confirmText: t('customers.people.detail.actions.delete', 'Delete'),
        cancelText: t('customers.people.detail.actions.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!approved) return
      await runMutationWithContext(
        () => deleteCrud('customers/people', { id: personId }),
        { id: personId, operation: 'deletePerson' },
      )
      flash(t('customers.people.list.deleteSuccess', 'Person deleted.'), 'success')
      router.push('/backend/customers/people')
    },
    [confirm, data?.person?.id, router, runMutationWithContext, t],
  )

  const handleHeaderSave = React.useCallback(() => {
    const form = formWrapperRef.current?.querySelector('form')
    if (form) form.requestSubmit()
  }, [])

  // Counts for tab badges
  const interactionCount = data?.counts?.activities ?? 0
  const todoCount = data?.counts?.todos ?? 0
  const companyCount = data?.counts?.companies ?? (data?.companies?.length ?? (data?.company ? 1 : 0))

  // Loading / error states
  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.people.detail.loading', 'Loading person…')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !data?.person?.id || !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error || t('customers.people.detail.error.notFound', 'Person not found.')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/customers/people">
                  {t('customers.people.detail.actions.backToList', 'Back to people')}
                </Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const personId = data.person.id
  const useCanonicalInteractions = data.interactionMode === 'canonical'

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          {/* UMES header injection */}
          <InjectionSpot spotId="detail:customers.person:header" context={injectionContext} data={data} />
          <InjectionSpot spotId="detail:customers.person:status-badges" context={injectionContext} data={data} />

          {/* Persistent person header */}
          <PersonDetailHeader
            data={data}
            onTagsChange={handleTagsChange}
            tagsSectionControllerRef={tagsSectionControllerRef}
            onSave={handleHeaderSave}
            onDelete={handleFormDelete}
            isDirty={isDirty}
            isSaving={isSaving}
            onOpenCompaniesTab={() => setActiveTab('companies')}
            onDataReload={() => { loadData().catch((err) => console.warn('[people-v2] onDataReload failed', err)) }}
            onFocusField={(fieldName) => {
              const selectorMap: Record<string, string> = {
                primaryEmail: 'input[type="email"]',
                primaryPhone: 'input[type="tel"]',
              }
              const selector = selectorMap[fieldName]
              const input = selector ? formWrapperRef.current?.querySelector<HTMLInputElement>(selector) : null
              if (input) {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' })
                requestAnimationFrame(() => input.focus())
              }
            }}
          />

          {/* Zone content shared between desktop (CollapsibleZoneLayout) and mobile (MobilePersonDetail). */}
          {(() => {
            const zone1Content = (
              <div ref={formWrapperRef}>
                <CrudForm<PersonEditFormValues>
                  embedded
                  trackDirtyWhenEmbedded
                  injectionSpotId="customers.person"
                  entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
                  schema={formSchema}
                  fields={fields}
                  groups={groups}
                  initialValues={initialValues}
                  onSubmit={handleFormSubmit}
                  onDelete={handleFormDelete}
                  hideFooterActions
                  collapsibleGroups={{ pageType: 'person-v2', chevronPosition: 'left' }}
                  sortableGroups={{ pageType: 'person-v2' }}
                  onDirtyChange={setIsDirty}
                />
              </div>
            )
            const zone2Content = (
              <PersonDetailTabs
                activeTab={activeTab}
                onTabChange={setActiveTab}
                injectedTabs={injectedTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
                activitiesCount={interactionCount}
                dealsCount={dealCount}
                companiesCount={companyCount}
                tasksCount={todoCount}
                sectionAction={sectionAction}
              >
                <div className="min-w-0">
                {(() => {
                  // Injected tab content
                  const injected = injectedTabMap.get(activeTab)
                  if (injected) return injected()

                  if (activeTab === 'activities') {
                    return (
                      <div className="space-y-4">
                        <ActivitiesCard
                          entityId={personId}
                          plannedActivities={plannedActivities}
                          refreshKey={activityRefreshKey}
                          onAddNew={handleAddActivity}
                          onEditActivity={handleEditActivity}
                          entityCompanyName={data.company?.displayName ?? data.companies?.[0]?.displayName ?? null}
                        />
                        <ActivitiesSection
                          entityId={personId}
                          entityName={personName}
                          useCanonicalInteractions={useCanonicalInteractions}
                          runGuardedMutation={runMutationWithContext}
                          onDataRefresh={handleActivityCreated}
                          refreshKey={activityRefreshKey}
                          addActionLabel={t('customers.people.detail.activities.add', 'Log activity')}
                          emptyState={{
                            title: t('customers.people.detail.emptyState.activities.title', 'No activities logged yet'),
                            actionLabel: t('customers.people.detail.emptyState.activities.action', 'Log activity'),
                          }}
                          onActionChange={handleSectionActionChange}
                          onEditActivity={handleEditActivity}
                        />
                      </div>
                    )
                  }

                  if (activeTab === 'deals') {
                    return (
                      <DealsSection
                        scope={dealsScope}
                        emptyLabel={t('customers.people.detail.empty.deals', 'No deals linked to this person.')}
                        addActionLabel={t('customers.people.detail.actions.addDeal', 'Add deal')}
                        emptyState={{
                          title: t('customers.people.detail.emptyState.deals.title', 'No deals yet'),
                          actionLabel: t('customers.people.detail.emptyState.deals.action', 'Create a deal'),
                        }}
                        onActionChange={handleSectionActionChange}
                        translator={detailTranslator}
                        runGuardedMutation={runMutationWithContext}
                        onCountDelta={(delta) => setDealCount((current) => Math.max(0, current + delta))}
                      />
                    )
                  }

                  if (activeTab === 'companies') {
                    return (
                      <PersonCompaniesSection
                        personId={personId}
                        personName={personName}
                        initialLinkedCompanies={data?.companies ?? []}
                        onChanged={loadData}
                        runGuardedMutation={runMutationWithContext}
                      />
                    )
                  }

                  if (activeTab === 'tasks') {
                    return (
                      <TasksSection
                        entityId={personId}
                        initialTasks={[]}
                        useCanonicalInteractions={useCanonicalInteractions}
                        runGuardedMutation={runMutationWithContext}
                        onDataRefresh={loadData}
                        emptyLabel={t('customers.people.detail.empty.todos', 'No tasks linked to this person.')}
                        addActionLabel={t('customers.people.detail.tasks.add', 'Add task')}
                        emptyState={{
                          title: t('customers.people.detail.emptyState.tasks.title', 'Plan what happens next'),
                          actionLabel: t('customers.people.detail.emptyState.tasks.action', 'Create task'),
                        }}
                        onActionChange={handleSectionActionChange}
                        translator={detailTranslator}
                        entityName={personName}
                        dialogContextKey="customers.people.detail.tasks.dialog.context"
                        dialogContextFallback="This task will be linked to {{name}}"
                      />
                    )
                  }

                  if (activeTab === 'files') {
                    return (
                      <AttachmentsSection
                        entityId={E.customers.customer_entity}
                        recordId={personId}
                        title={t('customers.people.detail.tabs.files', 'Files')}
                        description={t('customers.people.detail.files.subtitle', 'Upload and manage files linked to this person.')}
                      />
                    )
                  }

                  if (activeTab === 'changelog') {
                    return <ChangelogTab entityId={personId} entityType="person" />
                  }

                  return null
                })()}
                </div>
              </PersonDetailTabs>
            )
            return (
              <>
                <div className="md:hidden">
                  <MobilePersonDetail zone1={zone1Content} zone2={zone2Content} />
                </div>
                <div className="hidden md:block">
                  <CollapsibleZoneLayout
                    pageType="person-v2"
                    entityName={personName}
                    isDirty={isDirty}
                    sections={zoneSections}
                    zone1={zone1Content}
                    zone2={zone2Content}
                  />
                </div>
              </>
            )
          })()}

          {/* UMES footer injection */}
          <InjectionSpot spotId="detail:customers.person:footer" context={injectionContext} data={data} />

          {/* Schedule Activity Dialog — opened from PlannedActivities "+ Schedule" or other triggers */}
          <ScheduleActivityDialog
            open={scheduleDialogOpen}
            onClose={() => { setScheduleDialogOpen(false); setScheduleEditData(null) }}
            entityId={personId}
            entityName={personName}
            companyName={scheduleDialogCompanyName}
            entityType="person"
            onActivityCreated={handleActivityCreated}
            editData={scheduleEditData}
          />
          {ConfirmDialogElement}
        </div>
      </PageBody>
    </Page>
  )
}
