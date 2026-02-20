"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { DetailFieldsSection, type DetailFieldConfig } from '@open-mercato/ui/backend/detail'
import {
  ActivitiesSection,
} from '../../../../components/detail/ActivitiesSection'
import {
  NotesSection,
  type CommentSummary,
  type SectionAction,
} from '@open-mercato/ui/backend/detail'
import {
  TagsSection,
  type TagOption,
} from '../../../../components/detail/TagsSection'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { AddressesSection } from '../../../../components/detail/AddressesSection'
import { TasksSection } from '../../../../components/detail/TasksSection'
import { CustomDataSection } from '../../../../components/detail/CustomDataSection'
import { CompanyHighlights } from '../../../../components/detail/CompanyHighlights'
import { normalizeCustomFieldSubmitValue } from '../../../../components/detail/customFieldUtils'
import { InlineDictionaryEditor, renderMultilineMarkdownDisplay } from '../../../../components/detail/InlineEditors'
import { formatTemplate } from '../../../../components/detail/utils'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import {
  CompanyPeopleSection,
  type CompanyPersonSummary,
} from '../../../../components/detail/CompanyPeopleSection'
import { AnnualRevenueField } from '../../../../components/detail/AnnualRevenueField'
import type { ActivitySummary, DealSummary, TagSummary, TodoLinkSummary } from '../../../../components/detail/types'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { DetailTabsLayout } from '../../../../components/detail/DetailTabsLayout'

type CompanyOverview = {
  company: {
    id: string
    displayName: string
    description?: string | null
    ownerUserId?: string | null
    primaryEmail?: string | null
    primaryPhone?: string | null
    status?: string | null
    lifecycleStage?: string | null
    source?: string | null
    nextInteractionAt?: string | null
    nextInteractionName?: string | null
    nextInteractionRefId?: string | null
    nextInteractionIcon?: string | null
    nextInteractionColor?: string | null
    organizationId?: string | null
  }
  profile: {
    id: string
    legalName?: string | null
    brandName?: string | null
    domain?: string | null
    websiteUrl?: string | null
    industry?: string | null
    sizeBucket?: string | null
    annualRevenue?: string | null
  } | null
  customFields: Record<string, unknown>
  tags: TagSummary[]
  comments: CommentSummary[]
  activities: ActivitySummary[]
  deals: DealSummary[]
  todos: TodoLinkSummary[]
  people: CompanyPersonSummary[]
  viewer?: {
    userId: string | null
    name?: string | null
    email?: string | null
  } | null
}

type SectionKey = 'notes' | 'activities' | 'deals' | 'people' | 'addresses' | 'tasks' | string

export default function CustomerCompanyDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = React.useMemo(() => {
    const raw = searchParams?.get('tab')
    if (raw === 'notes' || raw === 'activities' || raw === 'deals' || raw === 'people' || raw === 'addresses' || raw === 'tasks') {
      return raw
    }
    return 'notes'
  }, [searchParams])
  const [data, setData] = React.useState<CompanyOverview | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<SectionKey>(initialTab)
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const currentCompanyId = data?.company?.id ?? null
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
  const sectionLoaderLabel =
    activeTab === 'activities'
      ? t('customers.companies.detail.activities.loading', 'Loading activities…')
      : activeTab === 'deals'
        ? t('customers.companies.detail.deals.loading', 'Loading deals…')
        : activeTab === 'people'
          ? t('customers.companies.detail.people.loading', 'Loading people…')
        : t('customers.companies.detail.sectionLoading', 'Loading…')
  const runMutation = React.useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => operation(), [])

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

  const validators = React.useMemo(() => ({
    email: (value: string) => {
      if (!value) return null
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(value) ? null : t('customers.companies.detail.inline.emailInvalid', 'Enter a valid email address.')
    },
    phone: (value: string) => {
      if (!value) return null
      return value.length >= 3 ? null : t('customers.companies.detail.inline.phoneInvalid', 'Phone number is too short.')
    },
    displayName: (value: string) => {
      const trimmed = value.trim()
      return trimmed.length ? null : t('customers.companies.form.displayName.error', 'Company name is required.')
    },
    website: (value: string) => {
      if (!value) return null
      try {
        const url = new URL(value.trim())
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? null
          : t('customers.companies.detail.inline.websiteInvalid', 'Use a valid http(s) address.')
      } catch {
        return t('customers.companies.detail.inline.websiteInvalid', 'Use a valid http(s) address.')
      }
    },
    annualRevenue: (value: string) => {
      if (!value) return null
      const normalized = value.replace(/[, ]+/g, '')
      const amount = Number(normalized)
      if (Number.isNaN(amount) || amount < 0) {
        return t('customers.companies.detail.inline.annualRevenueInvalid', 'Enter a non-negative number.')
      }
      return null
    },
  }), [t])

  const injectionContext = React.useMemo(
    () => ({ companyId: currentCompanyId, data }),
    [currentCompanyId, data],
  )
  const { widgets: injectedTabWidgets } = useInjectionWidgets('customers.company.detail:tabs', {
    context: injectionContext,
    triggerOnLoad: true,
  })
  const injectedTabs = React.useMemo(
    () =>
      (injectedTabWidgets ?? [])
        .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
        .map((widget) => {
          const id = widget.placement?.groupId ?? widget.widgetId
          const label = widget.placement?.groupLabel ?? widget.module.metadata.title
          const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
          const render = () => (
            <widget.module.Widget
              context={injectionContext}
              data={data}
              onDataChange={(next) => setData(next as CompanyOverview)}
            />
          )
          return { id, label, priority, render }
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

  React.useEffect(() => {
    if (!id) {
      setError(t('customers.companies.detail.error.notFound', 'Company not found.'))
      setIsLoading(false)
      return
    }
    const companyId = id
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const search = new URLSearchParams()
        search.append('include', 'todos')
        search.append('include', 'people')
        const payload = await readApiResultOrThrow<CompanyOverview>(
          `/api/customers/companies/${encodeURIComponent(companyId)}?${search.toString()}`,
          undefined,
          { errorMessage: t('customers.companies.detail.error.load', 'Failed to load company.') },
        )
        if (cancelled) return
        setData(payload as CompanyOverview)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('customers.companies.detail.error.load', 'Failed to load company.')
        setError(message)
        setData(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, t])

  const saveCompany = React.useCallback(
    async (patch: Record<string, unknown>, apply: (prev: CompanyOverview) => CompanyOverview) => {
      if (!data) return
      await apiCallOrThrow(
        '/api/customers/companies',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: data.company.id, ...patch }),
        },
        { errorMessage: t('customers.companies.detail.inline.error', 'Unable to update company.') },
      )
      setData((prev) => (prev ? apply(prev) : prev))
    },
    [data, t],
  )

  const updateDisplayName = React.useCallback(
    async (next: string | null) => {
      const send = typeof next === 'string' ? next : ''
      await saveCompany(
        { displayName: send },
        (prev) => ({
          ...prev,
          company: {
            ...prev.company,
            displayName: next && next.length ? next : prev.company.displayName,
          },
        })
      )
    },
    [saveCompany],
  )

  const updateCompanyField = React.useCallback(
    async (field: 'primaryEmail' | 'primaryPhone' | 'status' | 'lifecycleStage' | 'source', next: string | null) => {
      const send = typeof next === 'string' ? next : ''
      await saveCompany(
        { [field]: send },
        (prev) => ({
          ...prev,
          company: {
            ...prev.company,
            [field]: next && next.length ? next : null,
          },
        })
      )
    },
    [saveCompany],
  )

  const updateProfileField = React.useCallback(
    async (
      field: 'brandName' | 'legalName' | 'websiteUrl' | 'industry' | 'domain' | 'sizeBucket',
      next: string | null,
    ) => {
      const send = typeof next === 'string' ? next : ''
      await saveCompany(
        { [field]: send },
        (prev) => {
          if (!prev.profile) return prev
          const nextValue = next && next.length ? next : null
          return {
            ...prev,
            profile: {
              ...prev.profile,
              [field]: nextValue,
            },
          }
        }
      )
    },
    [saveCompany],
  )

  const submitCustomFields = React.useCallback(
    async (prefixedValues: Record<string, unknown>, { showFlash = true } = {}) => {
      if (!data) throw new Error(t('customers.companies.detail.inline.error', 'Unable to update company.'))
      const customPayload = collectCustomFieldValues(prefixedValues, {
        transform: (value) => normalizeCustomFieldSubmitValue(value),
      })
      const normalized: Record<string, unknown> = {}
      for (const [fieldId, value] of Object.entries(customPayload)) {
        normalized[`cf_${fieldId}`] = value
      }
      if (!Object.keys(customPayload).length) {
        if (showFlash) flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
        return
      }
      try {
        await apiCallOrThrow(
          '/api/customers/companies',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: data.company.id,
              customFields: customPayload,
            }),
          },
          { errorMessage: t('customers.companies.detail.inline.error', 'Unable to update company.') },
        )
      } catch (err) {
        const { message: helperMessage, fieldErrors } = mapCrudServerErrorToFormErrors(err)
        const message = helperMessage ?? t('customers.companies.detail.inline.error', 'Unable to update company.')
        const mappedErrors: Record<string, string> | undefined = fieldErrors
          ? Object.entries(fieldErrors).reduce<Record<string, string>>((acc, [key, value]) => {
              const formKey = key.startsWith('cf_') ? key : `cf_${key}`
              acc[formKey] = value
              return acc
            }, {})
          : undefined
        const error = new Error(message) as Error & { fieldErrors?: Record<string, string> }
        if (mappedErrors && Object.keys(mappedErrors).length) error.fieldErrors = mappedErrors
        throw error
      }
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          customFields: {
            ...prev.customFields,
            ...normalized,
          },
        }
      })
      if (showFlash) flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
    },
    [data, t],
  )

  const handleAnnualRevenueChange = React.useCallback(
    async ({ amount, currency }: { amount: number | null; currency: string | null }) => {
      await saveCompany(
        { annualRevenue: amount ?? null },
        (prev) => {
          if (!prev.profile) return prev
          return {
            ...prev,
            profile: {
              ...prev.profile,
              annualRevenue: amount === null ? null : String(amount),
            },
          }
        }
      )
      await submitCustomFields(
        { cf_annual_revenue_currency: currency ?? null },
        { showFlash: false },
      )
      flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
    },
    [saveCompany, submitCustomFields, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!currentCompanyId) return
    const confirmed = await confirm({
      title: t('customers.companies.list.deleteConfirm', undefined, { name: companyName }),
      variant: 'destructive',
    })
    if (!confirmed) return
    setIsDeleting(true)
    try {
      await apiCallOrThrow(
        `/api/customers/companies?id=${encodeURIComponent(currentCompanyId)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        },
        { errorMessage: t('customers.companies.list.deleteError', 'Failed to delete company.') },
      )
      flash(t('customers.companies.list.deleteSuccess', 'Company deleted.'), 'success')
      router.push('/backend/customers/companies')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.list.deleteError', 'Failed to delete company.')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [confirm, currentCompanyId, companyName, router, t])

  const handleTagsChange = React.useCallback((nextTags: TagOption[]) => {
    setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
  }, [])

  const handleCustomFieldsSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      await runMutation(() => submitCustomFields(values))
    },
    [runMutation, submitCustomFields],
  )

  const handleNotesLoadingChange = React.useCallback(() => {}, [])

  const handleActivitiesLoadingChange = React.useCallback(() => {}, [])

  const handleDealsLoadingChange = React.useCallback(() => {}, [])

  const handlePeopleLoadingChange = React.useCallback(() => {}, [])

  const handleAddressesLoadingChange = React.useCallback(() => {}, [])

  const handleTasksLoadingChange = React.useCallback(() => {}, [])

  const dealsScope = React.useMemo(
    () => (currentCompanyId ? ({ kind: 'company', entityId: currentCompanyId } as const) : null),
    [currentCompanyId],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('customers.companies.detail.loading', 'Loading company…')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !data?.company?.id) {
    return (
      <Page>
        <PageBody>
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{error || t('customers.companies.detail.error.notFound', 'Company not found.')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/customers/companies">
                {t('customers.companies.detail.actions.backToList', 'Back to companies')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const { company, profile } = data
  const companyId = company.id

  const annualRevenueCurrency =
    typeof data.customFields?.cf_annual_revenue_currency === 'string'
      ? (data.customFields.cf_annual_revenue_currency as string)
      : null

  const detailFields: DetailFieldConfig[] = [
    {
      key: 'displayName',
      kind: 'text',
      label: t('customers.companies.detail.fields.displayName', 'Display name'),
      value: company.displayName,
      placeholder: t('customers.companies.form.displayName.placeholder', 'Enter company name'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      validator: validators.displayName,
      onSave: (value) => runMutation(() => updateDisplayName(value)),
    },
    {
      key: 'legalName',
      kind: 'text',
      label: t('customers.companies.detail.fields.legalName', 'Legal name'),
      value: profile?.legalName ?? null,
      placeholder: t('customers.companies.detail.fields.legalNamePlaceholder', 'Add legal name'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => runMutation(() => updateProfileField('legalName', value)),
    },
    {
      key: 'brandName',
      kind: 'text',
      label: t('customers.companies.detail.fields.brandName', 'Brand name'),
      value: profile?.brandName ?? null,
      placeholder: t('customers.companies.detail.fields.brandNamePlaceholder', 'Add brand name'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => runMutation(() => updateProfileField('brandName', value)),
    },
    {
      key: 'description',
      kind: 'multiline',
      label: t('customers.companies.detail.fields.description', 'Description'),
      value: company.description ?? null,
      placeholder: t('customers.companies.detail.fields.descriptionPlaceholder', 'Describe the company'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      gridClassName: 'sm:col-span-2 xl:col-span-3',
      renderDisplay: renderMultilineMarkdownDisplay,
      onSave: async (next) => {
        const send = typeof next === 'string' ? next : ''
        await runMutation(() => saveCompany(
          { description: send },
          (prev) => ({
            ...prev,
            company: { ...prev.company, description: next && next.length ? next : null },
          })
        ))
      },
    },
    {
      key: 'lifecycleStage',
      kind: 'custom',
      label: t('customers.companies.detail.fields.lifecycleStage', 'Lifecycle stage'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      render: () => (
        <InlineDictionaryEditor
          label={t('customers.companies.detail.fields.lifecycleStage', 'Lifecycle stage')}
          value={company.lifecycleStage ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          kind="lifecycle-stages"
          onSave={(next) => runMutation(() => updateCompanyField('lifecycleStage', next))}
          selectClassName="h-9 w-full rounded border px-3 text-sm"
          variant="muted"
          activateOnClick
        />
      ),
    },
    {
      key: 'source',
      kind: 'custom',
      label: t('customers.companies.detail.fields.source', 'Source'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      render: () => (
        <InlineDictionaryEditor
          label={t('customers.companies.detail.fields.source', 'Source')}
          value={company.source ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          kind="sources"
          onSave={(next) => runMutation(() => updateCompanyField('source', next))}
          selectClassName="h-9 w-full rounded border px-3 text-sm"
          variant="muted"
          activateOnClick
        />
      ),
    },
    {
      key: 'domain',
      kind: 'text',
      label: t('customers.companies.detail.fields.domain', 'Domain'),
      value: profile?.domain ?? null,
      placeholder: t('customers.companies.detail.fields.domainPlaceholder', 'example.com'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => runMutation(() => updateProfileField('domain', value)),
    },
    {
      key: 'industry',
      kind: 'custom',
      label: t('customers.companies.detail.fields.industry', 'Industry'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      render: () => (
        <InlineDictionaryEditor
          label={t('customers.companies.detail.fields.industry', 'Industry')}
          value={profile?.industry ?? null}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          kind="industries"
          onSave={(next) => runMutation(() => updateProfileField('industry', next))}
          selectClassName="h-9 w-full rounded border px-3 text-sm"
          variant="muted"
          activateOnClick
        />
      ),
    },
    {
      key: 'sizeBucket',
      kind: 'text',
      label: t('customers.companies.detail.fields.sizeBucket', 'Company size'),
      value: profile?.sizeBucket ?? null,
      placeholder: t('customers.companies.detail.fields.sizeBucketPlaceholder', 'Add size bucket'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => runMutation(() => updateProfileField('sizeBucket', value)),
    },
    {
      key: 'annualRevenue',
      kind: 'custom',
      label: t('customers.companies.detail.fields.annualRevenue', 'Annual revenue'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      render: () => (
        <AnnualRevenueField
          label={t('customers.companies.detail.fields.annualRevenue', 'Annual revenue')}
          amount={profile?.annualRevenue ?? null}
          currency={annualRevenueCurrency}
          emptyLabel={t('customers.companies.detail.noValue', 'Not provided')}
          validator={validators.annualRevenue}
          onSave={(next) => runMutation(() => handleAnnualRevenueChange(next))}
        />
      ),
    },
    {
      key: 'websiteUrl',
      kind: 'text',
      label: t('customers.companies.detail.fields.website', 'Website'),
      value: profile?.websiteUrl ?? null,
      placeholder: t('customers.companies.detail.fields.websitePlaceholder', 'https://example.com'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      inputType: 'url',
      validator: validators.website,
      onSave: (value) => runMutation(() => updateProfileField('websiteUrl', value)),
    },
  ]

  return (
    <Page>
      <PageBody>
        <div className="space-y-8">
          <CompanyHighlights
            company={company}
            profile={profile ?? null}
            validators={validators}
            onDisplayNameSave={updateDisplayName}
            onPrimaryEmailSave={(value) => updateCompanyField('primaryEmail', value)}
            onPrimaryPhoneSave={(value) => updateCompanyField('primaryPhone', value)}
            onStatusSave={(value) => updateCompanyField('status', value)}
            onNextInteractionSave={async (payload) => {
              await saveCompany(
                {
                  nextInteraction: payload
                    ? {
                        at: payload.at,
                        name: payload.name ?? undefined,
                        refId: payload.refId ?? undefined,
                        icon: payload.icon ?? undefined,
                        color: payload.color ?? undefined,
                      }
                    : null,
                },
                (prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    nextInteractionAt: payload?.at ?? null,
                    nextInteractionName: payload?.name ?? null,
                    nextInteractionRefId: payload?.refId ?? null,
                    nextInteractionIcon: payload?.icon ?? null,
                    nextInteractionColor: payload?.color ?? null,
                  },
                })
              )
            }}
            onDelete={handleDelete}
            isDeleting={isDeleting}
          />

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
                    onLoadingChange={handleNotesLoadingChange}
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
                    addActionLabel={t('customers.companies.detail.activities.add', 'Log activity')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.activities.title', 'No activities logged yet'),
                      actionLabel: t('customers.companies.detail.emptyState.activities.action', 'Log activity'),
                    }}
                    onActionChange={handleSectionActionChange}
                    onLoadingChange={handleActivitiesLoadingChange}
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
                    onLoadingChange={handleDealsLoadingChange}
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
                    onLoadingChange={handlePeopleLoadingChange}
                    translator={detailTranslator}
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
                    onLoadingChange={handleAddressesLoadingChange}
                    translator={detailTranslator}
                  />
                )
              }
              if (activeTab === 'tasks') {
                return (
                  <TasksSection
                    entityId={companyId}
                    initialTasks={data.todos}
                    emptyLabel={t('customers.companies.detail.empty.todos', 'No tasks linked to this company.')}
                    addActionLabel={t('customers.companies.detail.tasks.add', 'Add task')}
                    emptyState={{
                      title: t('customers.companies.detail.emptyState.tasks.title', 'Plan what happens next'),
                      actionLabel: t('customers.companies.detail.emptyState.tasks.action', 'Create task'),
                    }}
                    onActionChange={handleSectionActionChange}
                    onLoadingChange={handleTasksLoadingChange}
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

          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{t('customers.companies.detail.sections.details', 'Company details')}</h2>
              <DetailFieldsSection fields={detailFields} />
              <InjectionSpot
                spotId="customers.company.detail:details"
                context={injectionContext}
                data={data}
                onDataChange={(next) => setData(next as CompanyOverview)}
              />
            </div>

            <CustomDataSection
              entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
              values={data.customFields ?? {}}
              onSubmit={handleCustomFieldsSubmit}
              title={t('customers.companies.detail.sections.customFields', 'Custom fields')}
            />

            <TagsSection
              entityId={companyId}
              tags={data.tags}
              onChange={handleTagsChange}
              isSubmitting={false}
            />
          </div>

          <Separator className="my-4" />
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
