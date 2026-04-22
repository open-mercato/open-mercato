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
import { CompanyPeopleSection, type CompanyPersonSummary } from '../../../../components/detail/CompanyPeopleSection'
import { AddressesSection } from '../../../../components/detail/AddressesSection'
import { TasksSection } from '../../../../components/detail/TasksSection'
import { TagsSection } from '../../../../components/detail/TagsSection'
import type { TagSummary } from '../../../../components/detail/types'
import { DetailTabsLayout } from '../../../../components/detail/DetailTabsLayout'
import { formatTemplate } from '../../../../components/detail/utils'
import { CompanyHighlightsSummary } from '../../../../components/detail/CustomerFormHighlights'
import type { TagsSectionController } from '@open-mercato/ui/backend/detail'
import {
  buildCompanyEditPayload,
  createCompanyEditFields,
  createCompanyEditGroups,
  createCompanyEditSchema,
  mapCompanyOverviewToFormValues,
  type CompanyEditFormValues,
  type CompanyOverview,
} from '../../../../components/formConfig'

type SectionKey = 'notes' | 'activities' | 'deals' | 'people' | 'addresses' | 'tasks' | string

const stableNoopCallback = () => {}

export default function CompanyDetailV2Page({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { organizationId } = useOrganizationScopeDetail()

  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])

  const formSchema = React.useMemo(() => createCompanyEditSchema(), [])
  const fields = React.useMemo(() => createCompanyEditFields(t), [t])
  const groups = React.useMemo(() => createCompanyEditGroups(t), [t])

  const [data, setData] = React.useState<CompanyOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const initialTab = React.useMemo(() => {
    const raw = searchParams?.get('tab')
    if (raw === 'notes' || raw === 'activities' || raw === 'deals' || raw === 'people' || raw === 'addresses' || raw === 'tasks') {
      return raw
    }
    return 'notes'
  }, [searchParams])
  const [activeTab, setActiveTab] = React.useState<SectionKey>(initialTab)
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)

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

  // Zone 2: Injection widgets for custom tabs
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
          const label = widget.placement?.groupLabel ?? widget.module.metadata.title
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

  const tabs = React.useMemo(
    () => [
      { id: 'notes' as const, label: t('customers.companies.detail.tabs.notes', 'Notes') },
      { id: 'activities' as const, label: t('customers.companies.detail.tabs.activities', 'Activities') },
      { id: 'deals' as const, label: t('customers.companies.detail.tabs.deals', 'Deals') },
      { id: 'people' as const, label: t('customers.companies.detail.tabs.people', 'People') },
      { id: 'addresses' as const, label: t('customers.companies.detail.tabs.addresses', 'Addresses') },
      { id: 'tasks' as const, label: t('customers.companies.detail.tabs.tasks', 'Tasks') },
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
    () => (currentCompanyId ? ({ kind: 'company', entityId: currentCompanyId } as const) : null),
    [currentCompanyId],
  )

  const initialValues = React.useMemo(
    () => (data ? mapCompanyOverviewToFormValues(data) : undefined),
    [data],
  )

  const contentHeader = React.useMemo(
    () => (data ? <CompanyHighlightsSummary data={data} /> : undefined),
    [data],
  )

  const handleFormSubmit = React.useCallback(
    async (values: CompanyEditFormValues) => {
      await tagsSectionControllerRef.current?.flush()

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
    },
    [loadData, organizationId, t],
  )

  const handleFormDelete = React.useCallback(
    async () => {
      await deleteCrud('customers/companies', { id: data?.company?.id ?? '' })
      flash(t('customers.companies.list.deleteSuccess', 'Company deleted.'), 'success')
      router.push('/backend/customers/companies')
    },
    [data?.company?.id, router, t],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customers.companies.detail.loading', 'Loading company…')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !data?.company?.id || !initialValues) {
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
        <div className="space-y-8">
          {/* UMES header injection */}
          <InjectionSpot spotId="detail:customers.company:header" context={injectionContext} data={data} />
          <InjectionSpot spotId="detail:customers.company:status-badges" context={injectionContext} data={data} />

          {/* Zone 1: CrudForm */}
          <CrudForm<CompanyEditFormValues>
            title={data.company.displayName}
            backHref="/backend/customers/companies"
            versionHistory={{
              resourceKind: 'customers.company',
              resourceId: companyId,
            }}
            injectionSpotId="customers.company"
            entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
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
            entityId={companyId}
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
            navAriaLabel={t('customers.companies.detail.tabs.label', 'Company detail sections')}
            navClassName="gap-4"
          >
            {(() => {
              const injected = injectedTabMap.get(activeTab)
              if (injected) return injected()
              if (activeTab === 'notes') {
                return (
                  <NotesSection
                    entityId={companyId}
                    emptyLabel={t('customers.companies.detail.empty.comments', 'No notes yet.')}
                    viewerUserId={data.viewer?.userId ?? null}
                    viewerName={data.viewer?.name ?? null}
                    viewerEmail={data.viewer?.email ?? null}
                    addActionLabel={t('customers.companies.detail.notes.addLabel', 'Add note')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.notes.title', 'Keep everyone in the loop'),
                      actionLabel: t('customers.companies.detail.emptyState.notes.action', 'Create a note'),
                    }}
                    onActionChange={handleSectionActionChange}
                    translator={translateCompanyDetail}
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
                    entityId={companyId}
                    useCanonicalInteractions={useCanonicalInteractions}
                    runGuardedMutation={runMutationWithContext}
                    onDataRefresh={loadData}
                    addActionLabel={t('customers.companies.detail.activities.add', 'Log activity')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.activities.title', 'No activities logged yet'),
                      actionLabel: t('customers.companies.detail.emptyState.activities.action', 'Log activity'),
                    }}
                    onActionChange={handleSectionActionChange}
                    onLoadingChange={stableNoopCallback}
                  />
                )
              }
              if (activeTab === 'deals') {
                return (
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
                )
              }
              if (activeTab === 'people') {
                return (
                  <CompanyPeopleSection
                    companyId={companyId}
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
                )
              }
              if (activeTab === 'addresses') {
                return (
                  <AddressesSection
                    entityId={companyId}
                    emptyLabel={t('customers.companies.detail.empty.addresses', 'No addresses recorded.')}
                    addActionLabel={t('customers.companies.detail.addresses.add', 'Add address')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.addresses.title', 'No addresses yet'),
                      actionLabel: t('customers.companies.detail.emptyState.addresses.action', 'Add address'),
                    }}
                    onActionChange={handleSectionActionChange}
                    translator={detailTranslator}
                  />
                )
              }
              if (activeTab === 'tasks') {
                return (
                  <TasksSection
                    entityId={companyId}
                    initialTasks={data.todos}
                    useCanonicalInteractions={useCanonicalInteractions}
                    runGuardedMutation={runMutationWithContext}
                    onDataRefresh={loadData}
                    emptyLabel={t('customers.companies.detail.empty.todos', 'No tasks linked to this company.')}
                    addActionLabel={t('customers.companies.detail.tasks.add', 'Add task')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.tasks.title', 'Plan what happens next'),
                      actionLabel: t('customers.companies.detail.emptyState.tasks.action', 'Create task'),
                    }}
                    onActionChange={handleSectionActionChange}
                    translator={translateCompanyDetail}
                    entityName={companyName}
                    dialogContextKey="customers.companies.detail.tasks.dialog.context"
                    dialogContextFallback="This task will be linked to {{name}}"
                  />
                )
              }
              return null
            })()}
          </DetailTabsLayout>

          {/* UMES footer injection */}
          <InjectionSpot spotId="detail:customers.company:footer" context={injectionContext} data={data} />
        </div>
      </PageBody>
    </Page>
  )
}
