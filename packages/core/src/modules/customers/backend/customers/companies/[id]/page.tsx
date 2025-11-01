"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { cn } from '@open-mercato/shared/lib/utils'
import { Plus } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import {
  ActivitiesSection,
} from '../../../../components/detail/ActivitiesSection'
import {
  NotesSection,
} from '../../../../components/detail/NotesSection'
import {
  TagsSection,
  type TagOption,
} from '../../../../components/detail/TagsSection'
import { DealsSection } from '../../../../components/detail/DealsSection'
import { AddressesSection } from '../../../../components/detail/AddressesSection'
import { TasksSection } from '../../../../components/detail/TasksSection'
import { LoadingMessage } from '../../../../components/detail/LoadingMessage'
import { DetailFieldsSection, type DetailFieldConfig } from '../../../../components/detail/DetailFieldsSection'
import { CustomDataSection } from '../../../../components/detail/CustomDataSection'
import { CompanyHighlights } from '../../../../components/detail/CompanyHighlights'
import { formatTemplate } from '../../../../components/detail/utils'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import {
  CompanyPeopleSection,
  type CompanyPersonSummary,
} from '../../../../components/detail/CompanyPeopleSection'
import type {
  ActivitySummary,
  CommentSummary,
  DealSummary,
  TagSummary,
  TodoLinkSummary,
  SectionAction,
} from '../../../../components/detail/types'

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

type SectionKey = 'notes' | 'activities' | 'deals' | 'people' | 'addresses' | 'tasks'

type SectionLoaderProps = { isLoading: boolean; label?: string }

function SectionLoader({ isLoading, label = 'Loading…' }: SectionLoaderProps) {
  if (!isLoading) return null
  return <LoadingMessage label={label} className="mb-4 mt-4 min-h-[160px]" />
}

export default function CustomerCompanyDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
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
  const [sectionPending, setSectionPending] = React.useState<Record<SectionKey, boolean>>({
    notes: false,
    activities: false,
    deals: false,
    people: false,
    addresses: false,
    tasks: false,
  })
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

  const tabs = React.useMemo(
    () => [
      { id: 'notes' as const, label: t('customers.companies.detail.tabs.notes', 'Notes') },
      { id: 'activities' as const, label: t('customers.companies.detail.tabs.activities', 'Activities') },
      { id: 'deals' as const, label: t('customers.companies.detail.tabs.deals', 'Deals') },
      { id: 'people' as const, label: t('customers.companies.detail.tabs.people', 'People') },
      { id: 'addresses' as const, label: t('customers.companies.detail.tabs.addresses', 'Addresses') },
      { id: 'tasks' as const, label: t('customers.companies.detail.tabs.tasks', 'Tasks') },
    ],
    [t],
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
        const res = await apiFetch(`/api/customers/companies/${encodeURIComponent(companyId)}?${search.toString()}`)
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          const message =
            typeof payload?.error === 'string' ? payload.error : t('customers.companies.detail.error.load', 'Failed to load company.')
          throw new Error(message)
        }
        const payload = await res.json()
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
      const res = await apiFetch('/api/customers/companies', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: data.company.id, ...patch }),
      })
      if (!res.ok) {
        let message = t('customers.companies.detail.inline.error', 'Unable to update company.')
        try {
          const details = await res.clone().json()
          if (details && typeof details.error === 'string') message = details.error
        } catch {
          // ignore
        }
        throw new Error(message)
      }
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
      const customPayload: Record<string, unknown> = {}
      const normalized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(prefixedValues)) {
        if (!key.startsWith('cf_')) continue
        const normalizedKey = key.slice(3)
        customPayload[normalizedKey] = value === undefined ? null : value
        normalized[key] = value === undefined ? null : value
      }
      if (!Object.keys(customPayload).length) {
        if (showFlash) flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
        return
      }
      const res = await apiFetch('/api/customers/companies', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: data.company.id,
          customFields: customPayload,
        }),
      })
      if (!res.ok) {
        let message = t('customers.companies.detail.inline.error', 'Unable to update company.')
        let fieldErrors: Record<string, string> | null = null
        try {
          const details = await res.clone().json()
          if (details && typeof details.error === 'string') message = details.error
          if (details && typeof details.fields === 'object' && details.fields !== null) {
            fieldErrors = {}
            for (const [rawKey, rawValue] of Object.entries(details.fields as Record<string, unknown>)) {
              const formKey = rawKey.startsWith('cf_') ? rawKey : `cf_${rawKey}`
              fieldErrors[formKey] = typeof rawValue === 'string' ? rawValue : message
            }
          }
        } catch {
          // ignore parsing errors
        }
        const err = new Error(message) as Error & { fieldErrors?: Record<string, string> }
        if (fieldErrors) err.fieldErrors = fieldErrors
        throw err
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
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(t('customers.companies.list.deleteConfirm', undefined, { name: companyName }))
    if (!confirmed) return
    setIsDeleting(true)
    try {
      const res = await apiFetch(`/api/customers/companies?id=${encodeURIComponent(currentCompanyId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      if (!res.ok) {
        const details = await res.json().catch(() => ({}))
        const message =
          typeof details?.error === 'string' ? details.error : t('customers.companies.list.deleteError', 'Failed to delete company.')
        throw new Error(message)
      }
      flash(t('customers.companies.list.deleteSuccess', 'Company deleted.'), 'success')
      router.push('/backend/customers/companies')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.list.deleteError', 'Failed to delete company.')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [currentCompanyId, companyName, router, t])

  const handleTagsChange = React.useCallback((nextTags: TagOption[]) => {
    setData((prev) => (prev ? { ...prev, tags: nextTags } : prev))
  }, [])

  const handleCustomFieldsSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      await submitCustomFields(values)
    },
    [submitCustomFields],
  )

  const handleNotesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, notes: loading }))
  }, [])

  const handleActivitiesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, activities: loading }))
  }, [])

  const handleDealsLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, deals: loading }))
  }, [])

  const handlePeopleLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, people: loading }))
  }, [])

  const handleAddressesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, addresses: loading }))
  }, [])

  const handleTasksLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, tasks: loading }))
  }, [])

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
              <a href="/backend/customers/companies">
                {t('customers.companies.detail.actions.backToList', 'Back to companies')}
              </a>
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
      onSave: updateDisplayName,
    },
    {
      key: 'legalName',
      kind: 'text',
      label: t('customers.companies.detail.fields.legalName', 'Legal name'),
      value: profile?.legalName ?? null,
      placeholder: t('customers.companies.detail.fields.legalNamePlaceholder', 'Add legal name'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => updateProfileField('legalName', value),
    },
    {
      key: 'brandName',
      kind: 'text',
      label: t('customers.companies.detail.fields.brandName', 'Brand name'),
      value: profile?.brandName ?? null,
      placeholder: t('customers.companies.detail.fields.brandNamePlaceholder', 'Add brand name'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => updateProfileField('brandName', value),
    },
    {
      key: 'description',
      kind: 'multiline',
      label: t('customers.companies.detail.fields.description', 'Description'),
      value: company.description ?? null,
      placeholder: t('customers.companies.detail.fields.descriptionPlaceholder', 'Describe the company'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      gridClassName: 'sm:col-span-2 xl:col-span-3',
      onSave: async (next) => {
        const send = typeof next === 'string' ? next : ''
        await saveCompany(
          { description: send },
          (prev) => ({
            ...prev,
            company: { ...prev.company, description: next && next.length ? next : null },
          })
        )
      },
    },
    {
      key: 'lifecycleStage',
      kind: 'dictionary',
      label: t('customers.companies.detail.fields.lifecycleStage', 'Lifecycle stage'),
      value: company.lifecycleStage ?? null,
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      dictionaryKind: 'lifecycle-stages',
      onSave: (next) => updateCompanyField('lifecycleStage', next),
      selectClassName: 'h-9 w-full rounded border px-3 text-sm',
    },
    {
      key: 'source',
      kind: 'dictionary',
      label: t('customers.companies.detail.fields.source', 'Source'),
      value: company.source ?? null,
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      dictionaryKind: 'sources',
      onSave: (next) => updateCompanyField('source', next),
      selectClassName: 'h-9 w-full rounded border px-3 text-sm',
    },
    {
      key: 'domain',
      kind: 'text',
      label: t('customers.companies.detail.fields.domain', 'Domain'),
      value: profile?.domain ?? null,
      placeholder: t('customers.companies.detail.fields.domainPlaceholder', 'example.com'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => updateProfileField('domain', value),
    },
    {
      key: 'industry',
      kind: 'dictionary',
      label: t('customers.companies.detail.fields.industry', 'Industry'),
      value: profile?.industry ?? null,
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      dictionaryKind: 'industries',
      onSave: (next) => updateProfileField('industry', next),
      selectClassName: 'h-9 w-full rounded border px-3 text-sm',
    },
    {
      key: 'sizeBucket',
      kind: 'text',
      label: t('customers.companies.detail.fields.sizeBucket', 'Company size'),
      value: profile?.sizeBucket ?? null,
      placeholder: t('customers.companies.detail.fields.sizeBucketPlaceholder', 'Add size bucket'),
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      onSave: (value) => updateProfileField('sizeBucket', value),
    },
    {
      key: 'annualRevenue',
      kind: 'annualRevenue',
      label: t('customers.companies.detail.fields.annualRevenue', 'Annual revenue'),
      value: profile?.annualRevenue ?? null,
      currency: annualRevenueCurrency,
      emptyLabel: t('customers.companies.detail.noValue', 'Not provided'),
      validator: validators.annualRevenue,
      onSave: handleAnnualRevenueChange,
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
      onSave: (value) => updateProfileField('websiteUrl', value),
    },
  ]

  return (
    <Page>
      <PageBody>
        <div className="space-y-8">
          <CompanyHighlights
            company={company}
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

          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav
                aria-label={t('customers.companies.detail.tabs.label', 'Company detail sections')}
                className="flex flex-wrap items-center gap-4"
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'relative -mb-px border-b-2 px-0 py-1 text-sm font-medium transition-colors',
                      activeTab === tab.id
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              {sectionAction ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSectionAction}
                  disabled={sectionAction.disabled}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {sectionAction.label}
                </Button>
              ) : null}
            </div>
            <div>
              {activeTab !== 'notes' ? (
                <SectionLoader
                  isLoading={sectionPending[activeTab as SectionKey]}
                  label={sectionLoaderLabel}
                />
              ) : null}
              {activeTab === 'notes' && (
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
                />
              )}
              {activeTab === 'activities' && (
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
                  onLoadingChange={handleDealsLoadingChange}
                  translator={detailTranslator}
                />
              )}
              {activeTab === 'people' && (
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
              )}
              {activeTab === 'addresses' && (
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
              )}
              {activeTab === 'tasks' && (
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
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{t('customers.companies.detail.sections.details', 'Company details')}</h2>
              <DetailFieldsSection fields={detailFields} />
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
    </Page>
  )
}
