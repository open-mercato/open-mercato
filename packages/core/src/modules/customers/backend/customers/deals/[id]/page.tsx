"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { NotesSection } from '../../../../components/detail/NotesSection'
import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { CustomDataSection } from '../../../../components/detail/CustomDataSection'
import { DealForm, type DealFormSubmitPayload } from '../../../../components/detail/DealForm'
import { LoadingMessage } from '../../../../components/detail/LoadingMessage'
import type { SectionAction } from '../../../../components/detail/types'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
}

type DealDetailPayload = {
  deal: {
    id: string
    title: string
    description: string | null
    status: string | null
    pipelineStage: string | null
    valueAmount: string | null
    valueCurrency: string | null
    probability: number | null
    expectedCloseAt: string | null
    ownerUserId: string | null
    source: string | null
    organizationId: string | null
    tenantId: string | null
    createdAt: string
    updatedAt: string
  }
  people: DealAssociation[]
  companies: DealAssociation[]
  customFields: Record<string, unknown>
  viewer?: {
    userId: string | null
    name?: string | null
    email?: string | null
  } | null
}

type SectionLoaderProps = { isLoading: boolean; label?: string }

function SectionLoader({ isLoading, label = 'Loading…' }: SectionLoaderProps) {
  if (!isLoading) return null
  return <LoadingMessage label={label} className="mb-4 mt-4 min-h-[160px]" />
}

const CRUD_FOCUSABLE_SELECTOR =
  '[data-crud-focus-target], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1")]'

function formatCurrency(amount: string | null, currency: string | null): string | null {
  if (!amount) return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return currency ? `${amount} ${currency}` : amount
  if (!currency) return value.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency}`
  }
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function DealDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = params?.id ?? ''
  const [data, setData] = React.useState<DealDetailPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState<'notes' | 'activities'>('notes')
  const [sectionPending, setSectionPending] = React.useState<{ notes: boolean; activities: boolean }>({
    notes: false,
    activities: false,
  })
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const handleNotesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, notes: loading }))
  }, [])
  const handleActivitiesLoadingChange = React.useCallback((loading: boolean) => {
    setSectionPending((prev) => ({ ...prev, activities: loading }))
  }, [])
  const focusDealField = React.useCallback(
    (fieldId: 'personIds' | 'companyIds') => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      const focusOnce = () => {
        const container = document.querySelector<HTMLElement>(`[data-crud-field-id="${fieldId}"]`)
        if (!container) return false
        const target =
          container.querySelector<HTMLElement>(CRUD_FOCUSABLE_SELECTOR) ?? container
        if (!target || typeof target.focus !== 'function') return false
        if (typeof container.scrollIntoView === 'function') {
          container.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        target.focus()
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          try {
            target.select()
          } catch {}
        }
        return true
      }

      const schedule = () => {
        const focused = focusOnce()
        if (focused) return
        window.setTimeout(() => {
          focusOnce()
        }, 60)
      }

      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(schedule)
      } else {
        schedule()
      }
    },
    [],
  )
  const handleEditPeopleAssignments = React.useCallback(() => {
    setActiveTab('notes')
    focusDealField('personIds')
  }, [focusDealField])
  const handleEditCompanyAssignments = React.useCallback(() => {
    setActiveTab('notes')
    focusDealField('companyIds')
  }, [focusDealField])

  React.useEffect(() => {
    if (!id) {
      setError(t('customers.deals.detail.missingId', 'Deal id is required.'))
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function loadDeal() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await apiFetch(`/api/customers/deals/${encodeURIComponent(id)}`)
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof payload?.error === 'string'
              ? payload.error
              : t('customers.deals.detail.loadError', 'Failed to load deal.')
          throw new Error(message)
        }
        if (cancelled) return
        setData(payload as DealDetailPayload)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.deals.detail.loadError', 'Failed to load deal.')
        setError(message)
        setData(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    loadDeal().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, reloadToken, t])

  const handleFormSubmit = React.useCallback(
    async ({ base, custom }: DealFormSubmitPayload) => {
      if (!data || isSaving) return
      setIsSaving(true)
      try {
        const payload: Record<string, unknown> = {
          id: data.deal.id,
          title: base.title,
          status: base.status ?? undefined,
          pipelineStage: base.pipelineStage ?? undefined,
          valueAmount: typeof base.valueAmount === 'number' ? base.valueAmount : undefined,
          valueCurrency: base.valueCurrency ?? undefined,
          probability: typeof base.probability === 'number' ? base.probability : undefined,
          expectedCloseAt: base.expectedCloseAt ?? undefined,
          description: base.description ?? undefined,
          personIds: base.personIds && base.personIds.length ? base.personIds : undefined,
          companyIds: base.companyIds && base.companyIds.length ? base.companyIds : undefined,
        }
        if (Object.keys(custom).length) payload.customFields = custom

        const res = await apiFetch('/api/customers/deals', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof body?.error === 'string'
              ? body.error
              : t('customers.deals.detail.saveError', 'Failed to update deal.')
          throw new Error(message)
        }
        flash(t('customers.deals.detail.saveSuccess', 'Deal updated.'), 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.deals.detail.saveError', 'Failed to update deal.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setIsSaving(false)
      }
    },
    [data, isSaving, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!data || isDeleting) return
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            t(
              'customers.deals.detail.deleteConfirm',
              'Delete this deal? This action cannot be undone.',
            ),
          )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      const res = await apiFetch('/api/customers/deals', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: data.deal.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof body?.error === 'string'
            ? body.error
            : t('customers.deals.detail.deleteError', 'Failed to delete deal.')
        throw new Error(message)
      }
      flash(t('customers.deals.detail.deleteSuccess', 'Deal deleted.'), 'success')
      router.push('/backend/customers/deals')
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.deals.detail.deleteError', 'Failed to delete deal.')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [data, isDeleting, router, t])

  const handleCustomFieldsSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (!data) {
        throw new Error(t('customers.deals.detail.saveError', 'Failed to update deal.'))
      }
      const customPayload: Record<string, unknown> = {}
      const prefixed: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('cf_')) continue
        const normalized = value === undefined ? null : value
        customPayload[key.slice(3)] = normalized
        prefixed[key] = normalized
      }
      if (!Object.keys(customPayload).length) {
        flash(t('ui.forms.flash.saveSuccess'), 'success')
        return
      }
      const res = await apiFetch('/api/customers/deals', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: data.deal.id, customFields: customPayload }),
      })
      if (!res.ok) {
        let message = t('customers.deals.detail.saveError', 'Failed to update deal.')
        let fieldErrors: Record<string, string> | null = null
        try {
          const body = await res.clone().json()
          if (body && typeof body.error === 'string') message = body.error
          if (body && typeof body.fields === 'object' && body.fields !== null) {
            fieldErrors = {}
            for (const [rawKey, rawMessage] of Object.entries(body.fields as Record<string, unknown>)) {
              const formKey = rawKey.startsWith('cf_') ? rawKey : `cf_${rawKey}`
              fieldErrors[formKey] = typeof rawMessage === 'string' ? rawMessage : message
            }
          }
        } catch {}
        const err = new Error(message) as Error & { fieldErrors?: Record<string, string> }
        if (fieldErrors) err.fieldErrors = fieldErrors
        throw err
      }
      setData((prev) => (prev ? { ...prev, customFields: { ...prev.customFields, ...prefixed } } : prev))
      flash(t('ui.forms.flash.saveSuccess'), 'success')
    },
    [data, t],
  )

  React.useEffect(() => {
    setSectionAction(null)
  }, [activeTab])

  const handleSectionAction = React.useCallback(() => {
    if (!sectionAction || sectionAction.disabled) return
    sectionAction.onClick()
  }, [sectionAction])

  const dealOptions = React.useMemo(
    () =>
      data
        ? [
            {
              id: data.deal.id,
              label:
                data.deal.title && data.deal.title.length
                  ? data.deal.title
                  : t('customers.deals.detail.untitled', 'Untitled deal'),
            },
          ]
        : [],
    [data, t],
  )

  const entityOptions = React.useMemo(() => {
    if (!data) return []
    const entries: { id: string; label: string }[] = []
    data.people.forEach((person) => {
      if (!person.id) return
      const suffix = person.subtitle ? ` · ${person.subtitle}` : ''
      entries.push({ id: person.id, label: `${person.label}${suffix}` })
    })
    data.companies.forEach((company) => {
      if (!company.id) return
      const suffix = company.subtitle ? ` · ${company.subtitle}` : ''
      entries.push({ id: company.id, label: `${company.label}${suffix}` })
    })
    return entries
  }, [data])

  const defaultEntityId = React.useMemo(() => {
    if (entityOptions.length) return entityOptions[0].id
    return null
  }, [entityOptions])

  const tabs = React.useMemo(
    () => [
      { id: 'notes' as const, label: t('customers.deals.detail.tabs.notes', 'Notes') },
      { id: 'activities' as const, label: t('customers.deals.detail.tabs.activities', 'Activities') },
    ],
    [t],
  )

  const sectionLoaderLabel = activeTab === 'activities'
    ? t('customers.deals.detail.activitiesLoading', 'Loading activities…')
    : t('customers.deals.detail.notesLoading', 'Loading notes…')

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('customers.deals.detail.loading', 'Loading deal…')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <p>{error || t('customers.deals.detail.notFound', 'Deal not found.')}</p>
            <Button variant="outline" asChild>
              <Link href="/backend/customers/deals">
                {t('customers.deals.detail.backToList', 'Back to deals')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const probabilityLabel = data.deal.probability !== null && data.deal.probability !== undefined
    ? `${data.deal.probability}%`
    : t('customers.deals.detail.noValue', 'Not provided')
  const valueLabel =
    formatCurrency(data.deal.valueAmount, data.deal.valueCurrency) ??
    t('customers.deals.detail.noValue', 'Not provided')
  const expectedCloseLabel = formatDate(data.deal.expectedCloseAt, t('customers.deals.detail.noValue', 'Not provided'))

  const viewer = data.viewer ?? null

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">{data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('customers.deals.detail.summary', {
                  status: data.deal.status ?? t('customers.deals.detail.noStatus', 'No status'),
                  pipeline: data.deal.pipelineStage ?? t('customers.deals.detail.noPipeline', 'No pipeline'),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
                {t('ui.actions.refresh', 'Refresh')}
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? t('ui.actions.deleting', 'Deleting…') : t('ui.actions.delete', 'Delete')}
              </Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1.1fr)]">
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-4">
                <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
                  {t('customers.deals.detail.highlights', 'Highlights')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.value', 'Deal value')}
                    </p>
                    <p className="text-base font-semibold text-foreground">{valueLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.probability', 'Probability')}
                    </p>
                    <p className="text-base font-semibold text-foreground">{probabilityLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.pipeline', 'Pipeline stage')}
                    </p>
                    <p className="text-base text-foreground">
                      {data.deal.pipelineStage ?? t('customers.deals.detail.noValue', 'Not provided')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.expectedClose', 'Expected close')}
                    </p>
                    <p className="text-base text-foreground">{expectedCloseLabel}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative -mb-px border-b-2 px-0 py-1 text-sm font-medium transition-colors ${
                          activeTab === tab.id
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {sectionAction ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={sectionAction.disabled}
                      onClick={handleSectionAction}
                    >
                      {sectionAction.label}
                    </Button>
                  ) : null}
                </div>
                <SectionLoader
                  isLoading={sectionPending[activeTab]}
                  label={sectionLoaderLabel}
                />
                {activeTab === 'notes' ? (
                  <NotesSection
                    entityId={null}
                    dealId={data.deal.id}
                    dealOptions={dealOptions}
                    entityOptions={entityOptions}
                    emptyLabel={t('customers.deals.detail.notesEmpty', 'No notes yet.')}
                    viewerUserId={viewer?.userId ?? null}
                    viewerName={viewer?.name ?? null}
                    viewerEmail={viewer?.email ?? null}
                    addActionLabel={t('customers.deals.detail.notesAdd', 'Add note')}
                    emptyState={{
                      title: t('customers.deals.detail.notesEmptyTitle', 'Keep everyone in the loop'),
                      actionLabel: t('customers.deals.detail.notesEmptyAction', 'Add a note'),
                    }}
                    onActionChange={setSectionAction}
                    translator={t}
                    onLoadingChange={handleNotesLoadingChange}
                  />
                ) : null}
                {activeTab === 'activities' ? (
                  <ActivitiesSection
                    entityId={null}
                    dealId={data.deal.id}
                    dealOptions={dealOptions}
                    entityOptions={entityOptions}
                    defaultEntityId={defaultEntityId ?? undefined}
                    addActionLabel={t('customers.deals.detail.activitiesAdd', 'Log activity')}
                    emptyState={{
                      title: t('customers.deals.detail.activitiesEmptyTitle', 'No activities yet'),
                      actionLabel: t('customers.deals.detail.activitiesEmptyAction', 'Add an activity'),
                    }}
                    onActionChange={setSectionAction}
                    onLoadingChange={handleActivitiesLoadingChange}
                  />
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t('customers.deals.detail.peopleSection', 'People')}
                    </h3>
                    <Button variant="ghost" size="xs" onClick={handleEditPeopleAssignments}>
                      {t('customers.deals.detail.editAssignments', 'Edit assignments')}
                    </Button>
                  </div>
                  {data.people.length ? (
                    <ul className="space-y-2 text-sm">
                      {data.people.map((person) => (
                        <li key={person.id} className="flex flex-col">
                          <Link href={`/backend/customers/people/${encodeURIComponent(person.id)}`} className="font-medium text-foreground hover:underline">
                            {person.label}
                          </Link>
                          {person.subtitle ? (
                            <span className="text-xs text-muted-foreground">{person.subtitle}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('customers.deals.detail.noPeople', 'No people linked to this deal yet.')}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t('customers.deals.detail.companiesSection', 'Companies')}
                    </h3>
                    <Button variant="ghost" size="xs" onClick={handleEditCompanyAssignments}>
                      {t('customers.deals.detail.editAssignments', 'Edit assignments')}
                    </Button>
                  </div>
                  {data.companies.length ? (
                    <ul className="space-y-2 text-sm">
                      {data.companies.map((company) => (
                        <li key={company.id} className="flex flex-col">
                          <Link href={`/backend/customers/companies/${encodeURIComponent(company.id)}`} className="font-medium text-foreground hover:underline">
                            {company.label}
                          </Link>
                          {company.subtitle ? (
                            <span className="text-xs text-muted-foreground">{company.subtitle}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('customers.deals.detail.noCompanies', 'No companies linked to this deal yet.')}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-4">
                <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
                  {t('customers.deals.detail.formTitle', 'Deal settings')}
                </h2>
                <DealForm
                  key={data.deal.updatedAt}
                  mode="edit"
                  initialValues={{
                    id: data.deal.id,
                    title: data.deal.title ?? '',
                    status: data.deal.status ?? '',
                    pipelineStage: data.deal.pipelineStage ?? '',
                    valueAmount: data.deal.valueAmount ? Number(data.deal.valueAmount) : null,
                    valueCurrency: data.deal.valueCurrency ?? undefined,
                    probability: data.deal.probability ?? null,
                    expectedCloseAt: data.deal.expectedCloseAt ?? null,
                    description: data.deal.description ?? '',
                    personIds: data.people.map((person) => person.id),
                    companyIds: data.companies.map((company) => company.id),
                    people: data.people.map((person) => ({ id: person.id, label: person.label })),
                    companies: data.companies.map((company) => ({ id: company.id, label: company.label })),
                    ...Object.fromEntries(
                      Object.entries(data.customFields)
                        .filter(([key]) => key.startsWith('cf_'))
                        .map(([key, value]) => [key, value]),
                    ),
                  }}
                  onSubmit={handleFormSubmit}
                  onCancel={() => setReloadToken((token) => token + 1)}
                  onDelete={handleDelete}
                  isSubmitting={isSaving || isDeleting}
                />
              </div>

              <CustomDataSection
                entityIds={[E.customers.customer_deal]}
                values={data.customFields}
                onSubmit={handleCustomFieldsSubmit}
                title={t('customers.deals.detail.customFields', 'Custom data')}
              />
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
