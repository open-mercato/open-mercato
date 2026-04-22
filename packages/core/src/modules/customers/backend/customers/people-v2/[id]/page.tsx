"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage, NotesSection, type SectionAction } from '@open-mercato/ui/backend/detail'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { AddressesSection } from '../../../../components/detail/AddressesSection'
import { TasksSection } from '../../../../components/detail/TasksSection'
import { TagsSection } from '../../../../components/detail/TagsSection'
import type { TagSummary } from '../../../../components/detail/types'
import { DetailTabsLayout } from '../../../../components/detail/DetailTabsLayout'
import { PersonHighlightsSummary } from '../../../../components/detail/CustomerFormHighlights'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import {
  buildPersonEditPayload,
  createPersonEditFields,
  createPersonEditGroups,
  createPersonEditSchema,
  mapPersonOverviewToFormValues,
  type PersonEditFormValues,
  type PersonOverview,
} from '../../../../components/formConfig'

type SectionKey = 'notes' | 'activities' | 'deals' | 'addresses' | 'tasks' | string

export default function PersonDetailV2Page({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { organizationId } = useOrganizationScopeDetail()

  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])

  const formSchema = React.useMemo(() => createPersonEditSchema(), [])
  const fields = React.useMemo(() => createPersonEditFields(t), [t])
  const groups = React.useMemo(() => createPersonEditGroups(t), [t])

  const [data, setData] = React.useState<PersonOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const initialTab = React.useMemo(() => {
    const raw = searchParams?.get('tab')
    if (raw === 'notes' || raw === 'activities' || raw === 'deals' || raw === 'addresses' || raw === 'tasks') {
      return raw
    }
    return 'notes'
  }, [searchParams])
  const [activeTab, setActiveTab] = React.useState<SectionKey>(initialTab)
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)

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
  const personName =
    data?.person?.displayName && data.person.displayName.trim().length
      ? data.person.displayName
      : t('customers.people.list.deleteFallbackName', 'this person')

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
      const search = new URLSearchParams()
      search.append('include', 'todos')
      search.append('include', 'interactions')
      const payload = await readApiResultOrThrow<PersonOverview>(
        `/api/customers/people/${encodeURIComponent(id)}?${search.toString()}`,
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
    loadData().catch(() => {})
  }, [loadData])

  // Zone 2: Injection widgets for custom tabs
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
          const label = widget.placement?.groupLabel ?? widget.module.metadata.title
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

  const tabs = React.useMemo(
    () => [
      { id: 'notes' as const, label: t('customers.people.detail.tabs.notes', 'Notes') },
      { id: 'activities' as const, label: t('customers.people.detail.tabs.activities', 'Activities') },
      { id: 'deals' as const, label: t('customers.people.detail.tabs.deals', 'Deals') },
      { id: 'addresses' as const, label: t('customers.people.detail.tabs.addresses', 'Addresses') },
      { id: 'tasks' as const, label: t('customers.people.detail.tabs.tasks', 'Tasks') },
      ...injectedTabs.map((tab) => ({ id: tab.id as SectionKey, label: tab.label })),
    ],
    [injectedTabs, t],
  )

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

  const handleTagsChange = React.useCallback((nextTags: TagSummary[]) => {
    setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
  }, [])
  const tagsSectionControllerRef = React.useRef<TagsSectionController | null>(null)

  const dealsScope = React.useMemo(
    () => (currentPersonId ? ({ kind: 'person', entityId: currentPersonId } as const) : null),
    [currentPersonId],
  )

  const initialValues = React.useMemo(
    () => (data ? mapPersonOverviewToFormValues(data) : undefined),
    [data],
  )

  const contentHeader = React.useMemo(
    () => (data ? <PersonHighlightsSummary data={data} /> : undefined),
    [data],
  )

  const handleFormSubmit = React.useCallback(
    async (values: PersonEditFormValues) => {
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
    },
    [loadData, organizationId, t],
  )

  const handleFormDelete = React.useCallback(
    async () => {
      await deleteCrud('customers/people', { id: data?.person?.id ?? '' })
      flash(t('customers.people.list.deleteSuccess', 'Person deleted.'), 'success')
      router.push('/backend/customers/people')
    },
    [data?.person?.id, router, t],
  )

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
        <div className="space-y-8">
          {/* UMES header injection */}
          <InjectionSpot spotId="detail:customers.person:header" context={injectionContext} data={data} />
          <InjectionSpot spotId="detail:customers.person:status-badges" context={injectionContext} data={data} />

          {/* Zone 1: CrudForm */}
          <CrudForm<PersonEditFormValues>
            title={data.person.displayName}
            backHref="/backend/customers/people"
            versionHistory={{
              resourceKind: 'customers.person',
              resourceId: personId,
            }}
            injectionSpotId="customers.person"
            entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
            schema={formSchema}
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            contentHeader={contentHeader}
            onSubmit={handleFormSubmit}
            onDelete={handleFormDelete}
          />

          <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {t(
              'customers.detail.saveGuide',
              'Profile fields save with the main Save button. Tags save automatically. The related sections below save independently inside their own tabs and panels.',
            )}
          </div>

          {/* Tags (independent save) */}
          <TagsSection
            entityId={personId}
            tags={data.tags}
            onChange={handleTagsChange}
            isSubmitting={false}
            controllerRef={tagsSectionControllerRef}
          />

          {/* Zone 2: Related Data Tabs */}
          <DetailTabsLayout
            className="space-y-6"
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            sectionAction={sectionAction}
            onSectionAction={handleSectionAction}
            navAriaLabel={t('customers.people.detail.tabs.label', 'Person detail sections')}
            navClassName="gap-4"
          >
            {(() => {
              const injected = injectedTabMap.get(activeTab)
              if (injected) return injected()
              if (activeTab === 'notes') {
                return (
                  <NotesSection
                    entityId={personId}
                    emptyLabel={t('customers.people.detail.empty.comments', 'No notes yet.')}
                    viewerUserId={data.viewer?.userId ?? null}
                    viewerName={data.viewer?.name ?? null}
                    viewerEmail={data.viewer?.email ?? null}
                    addActionLabel={t('customers.people.detail.notes.addLabel', 'Add note')}
                    emptyState={{
                      title: t('customers.people.detail.emptyState.notes.title', 'Keep everyone in the loop'),
                      actionLabel: t('customers.people.detail.emptyState.notes.action', 'Create a note'),
                    }}
                    onActionChange={handleSectionActionChange}
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
              if (activeTab === 'activities') {
                return (
                  <ActivitiesSection
                    entityId={personId}
                    useCanonicalInteractions={useCanonicalInteractions}
                    runGuardedMutation={runMutationWithContext}
                    onDataRefresh={loadData}
                    addActionLabel={t('customers.people.detail.activities.add', 'Log activity')}
                    emptyState={{
                      title: t('customers.people.detail.emptyState.activities.title', 'No activities logged yet'),
                      actionLabel: t('customers.people.detail.emptyState.activities.action', 'Log activity'),
                    }}
                    onActionChange={handleSectionActionChange}
                  />
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
                  />
                )
              }
              if (activeTab === 'addresses') {
                return (
                  <AddressesSection
                    entityId={personId}
                    emptyLabel={t('customers.people.detail.empty.addresses', 'No addresses recorded.')}
                    addActionLabel={t('customers.people.detail.addresses.add', 'Add address')}
                    emptyState={{
                      title: t('customers.people.detail.emptyState.addresses.title', 'No addresses yet'),
                      actionLabel: t('customers.people.detail.emptyState.addresses.action', 'Add address'),
                    }}
                    onActionChange={handleSectionActionChange}
                    translator={detailTranslator}
                  />
                )
              }
              if (activeTab === 'tasks') {
                return (
                  <TasksSection
                    entityId={personId}
                    initialTasks={data.todos}
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
              return null
            })()}
          </DetailTabsLayout>

          {/* UMES footer injection */}
          <InjectionSpot spotId="detail:customers.person:footer" context={injectionContext} data={data} />
        </div>
      </PageBody>
    </Page>
  )
}
