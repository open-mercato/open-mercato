"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, MousePointerClick } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { NotesSection, type SectionAction } from '@open-mercato/ui/backend/detail'
import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { DealForm, type DealFormSubmitPayload } from '../../../../components/detail/DealForm'
import { useCustomerDictionary } from '../../../../components/detail/hooks/useCustomerDictionary'
import type { CustomerDictionaryMap } from '../../../../lib/dictionaries'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'

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

function resolveDictionaryLabel(
  value: string | null | undefined,
  map: CustomerDictionaryMap | null | undefined,
): string | null {
  if (!value) return null
  const entry = map?.[value]
  if (entry && entry.label && entry.label.length) return entry.label
  return value
}

export default function DealDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const notesAdapter = React.useMemo(() => createCustomerNotesAdapter(detailTranslator), [detailTranslator])
  const router = useRouter()
  const id = params?.id ?? ''
  const scopeVersion = useOrganizationScopeVersion()
  const statusDictionaryQuery = useCustomerDictionary('deal-statuses', scopeVersion)
  const pipelineDictionaryQuery = useCustomerDictionary('pipeline-stages', scopeVersion)
  const statusDictionaryMap = statusDictionaryQuery.data?.map ?? null
  const pipelineDictionaryMap = pipelineDictionaryQuery.data?.map ?? null
  const [data, setData] = React.useState<DealDetailPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState<'notes' | 'activities'>('notes')
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const handleNotesLoadingChange = React.useCallback(() => {}, [])
  const handleActivitiesLoadingChange = React.useCallback(() => {}, [])
  const focusDealField = React.useCallback(
    (fieldId: 'title' | 'personIds' | 'companyIds') => {
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
  const dealSettingsRef = React.useRef<HTMLDivElement | null>(null)
  const scrollToDealSettings = React.useCallback(() => {
    if (typeof window === 'undefined') return
    if (dealSettingsRef.current && typeof dealSettingsRef.current.scrollIntoView === 'function') {
      dealSettingsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.setTimeout(() => {
      focusDealField('title')
    }, 160)
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
        const payload = await readApiResultOrThrow<DealDetailPayload>(
          `/api/customers/deals/${encodeURIComponent(id)}`,
          undefined,
          { errorMessage: t('customers.deals.detail.loadError', 'Failed to load deal.') },
        )
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

        await apiCallOrThrow(
          '/api/customers/deals',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('customers.deals.detail.saveError', 'Failed to update deal.') },
        )
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
    const confirmed = await confirm({
      title: t(
        'customers.deals.detail.deleteConfirm',
        'Delete this deal? This action cannot be undone.',
      ),
      variant: 'destructive',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      await apiCallOrThrow(
        '/api/customers/deals',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: data.deal.id }),
        },
        { errorMessage: t('customers.deals.detail.deleteError', 'Failed to delete deal.') },
      )
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
  }, [confirm, data, isDeleting, router, t])

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
  const statusLabel =
    resolveDictionaryLabel(data.deal.status, statusDictionaryMap) ??
    t('customers.deals.detail.noStatus', 'No status')
  const pipelineLabel = resolveDictionaryLabel(data.deal.pipelineStage, pipelineDictionaryMap)

  const peopleSummaryLabel =
    data.people.length === 1
      ? t('customers.deals.detail.peopleSummaryOne')
      : t('customers.deals.detail.peopleSummaryMany', undefined, { count: data.people.length })
  const companiesSummaryLabel =
    data.companies.length === 1
      ? t('customers.deals.detail.companiesSummaryOne')
      : t('customers.deals.detail.companiesSummaryMany', undefined, { count: data.companies.length })

  const viewer = data.viewer ?? null

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6">
          <FormHeader
            mode="detail"
            backHref="/backend/customers/deals"
            backLabel={t('customers.deals.detail.backToList', 'Back to deals')}
            utilityActions={(
              <VersionHistoryAction
                config={{ resourceKind: 'customers.deal', resourceId: data.deal.id }}
                t={t}
              />
            )}
            title={
              <div className="flex flex-wrap items-center gap-2">
                <span>{data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground hover:text-foreground"
                  onClick={scrollToDealSettings}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  <MousePointerClick className="h-4 w-4" aria-hidden />
                  <span>{t('customers.deals.detail.goToSettings', 'Edit deal details')}</span>
                </Button>
              </div>
            }
            subtitle={t('customers.deals.detail.summary', undefined, {
              status: statusLabel,
              pipeline: pipelineLabel ?? t('customers.deals.detail.noPipeline', 'No pipeline'),
            })}
            onDelete={handleDelete}
            isDeleting={isDeleting}
            deleteLabel={t('ui.actions.delete', 'Delete')}
          />
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
                      {pipelineLabel ?? t('customers.deals.detail.noValue', 'Not provided')}
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
                      {sectionAction.icon ?? null}
                      {sectionAction.label}
                    </Button>
                  ) : null}
                </div>
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
                    translator={detailTranslator}
                    onLoadingChange={handleNotesLoadingChange}
                    dataAdapter={notesAdapter}
                    renderIcon={renderDictionaryIcon}
                    renderColor={renderDictionaryColor}
                    iconSuggestions={ICON_SUGGESTIONS}
                    readMarkdownPreference={readMarkdownPreferenceCookie}
                    writeMarkdownPreference={writeMarkdownPreferenceCookie}
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
                  <div className="mb-3 space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t('customers.deals.detail.peopleSection', 'People')}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {peopleSummaryLabel}
                    </p>
                  </div>
                  {data.people.length ? (
                    <ul className="space-y-2 text-sm">
                      {data.people.map((person) => (
                        <li key={person.id} className="flex flex-col gap-1">
                          <Link href={`/backend/customers/people/${encodeURIComponent(person.id)}`} className="font-medium text-foreground hover:underline">
                            {person.label}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {person.subtitle ?? t('customers.deals.detail.peopleNoDetails', 'No additional details')}
                          </span>
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
                  <div className="mb-3 space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t('customers.deals.detail.companiesSection', 'Companies')}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {companiesSummaryLabel}
                    </p>
                  </div>
                  {data.companies.length ? (
                    <ul className="space-y-2 text-sm">
                      {data.companies.map((company) => (
                        <li key={company.id} className="flex flex-col gap-1">
                          <Link href={`/backend/customers/companies/${encodeURIComponent(company.id)}`} className="font-medium text-foreground hover:underline">
                            {company.label}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {company.subtitle ?? t('customers.deals.detail.companiesNoDetails', 'No additional details')}
                          </span>
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
              <div
                ref={dealSettingsRef}
                id="deal-settings"
                className="rounded-lg border bg-card p-4"
              >
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
            </div>
          </div>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
