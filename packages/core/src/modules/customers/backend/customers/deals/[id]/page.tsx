"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Pencil, MousePointerClick } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { NotesSection, AttachmentsSection, type SectionAction } from '@open-mercato/ui/backend/detail'
import { ActivitiesSection } from '../../../../components/detail/ActivitiesSection'
import { DealForm, type DealFormSubmitPayload } from '../../../../components/detail/DealForm'
import { useCustomerDictionary } from '../../../../components/detail/hooks/useCustomerDictionary'
import type { CustomerDictionaryMap } from '../../../../lib/dictionaries'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ICON_SUGGESTIONS } from '../../../../lib/dictionaries'
import { createCustomerNotesAdapter } from '../../../../components/detail/notesAdapter'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '../../../../lib/markdownPreference'
import { DealTimelineAction } from '../../../../components/detail/DealTimelineAction'

type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
  role?: string | null
}

type DealDetailPayload = {
  lineCount: number
  deal: {
    id: string
    title: string
    description: string | null
    status: string | null
    pipelineStage: string | null
    pipelineId: string | null
    pipelineStageId: string | null
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
  '[data-crud-focus-target], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  const contactRoleDictionaryQuery = useCustomerDictionary('deal-contact-roles', scopeVersion)
  const statusDictionaryMap = statusDictionaryQuery.data?.map ?? null
  const pipelineDictionaryMap = pipelineDictionaryQuery.data?.map ?? null
  const contactRoleOptions = React.useMemo(() => {
    const map = contactRoleDictionaryQuery.data?.map
    if (!map) return [] as { value: string; label: string }[]
    return Object.entries(map).map(([value, entry]) => ({
      value,
      label: entry.label || value,
    }))
  }, [contactRoleDictionaryQuery.data?.map])
  const [data, setData] = React.useState<DealDetailPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState<'notes' | 'activities' | 'stage-history' | 'products' | 'files' | 'emails'>('notes')
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

  const updateContactRoleMutation = useMutation({
    mutationFn: async ({ personId, role }: { personId: string; role: string | null }) => {
      await apiCallOrThrow(
        `/api/customers/deals/${encodeURIComponent(id)}/contacts`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ personId, role }),
        },
        { errorMessage: t('customers.deals.detail.roleUpdateError', 'Failed to update contact role.') },
      )
      return { personId, role }
    },
    onSuccess: ({ personId, role }) => {
      flash(t('customers.deals.detail.roleUpdateSuccess', 'Contact role updated.'), 'success')
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          people: prev.people.map((p) =>
            p.id === personId ? { ...p, role } : p,
          ),
        }
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : t('customers.deals.detail.roleUpdateError', 'Failed to update contact role.')
      flash(message, 'error')
    },
  })

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
          pipelineId: base.pipelineId ?? undefined,
          pipelineStageId: base.pipelineStageId ?? undefined,
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
      { id: 'products' as const, label: t('customers.deals.detail.tabs.products', 'Products') },
      { id: 'stage-history' as const, label: t('customers.deals.detail.tabs.stageHistory', 'Stage history') },
      { id: 'files' as const, label: t('customers.deals.detail.tabs.files', 'Files') },
      { id: 'emails' as const, label: t('customers.deals.detail.tabs.emails', 'Emails') },
    ],
    [t],
  )

  const stageHistoryQuery = useQuery<{ data: Array<{ id: string; fromStageLabel: string | null; toStageLabel: string; durationSeconds: number | null; createdAt: string }> }>({
    queryKey: ['customers', 'deals', id, 'stage-history', `scope:${scopeVersion}`],
    enabled: activeTab === 'stage-history' && !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ data: Array<{ id: string; fromStageLabel: string | null; toStageLabel: string; durationSeconds: number | null; createdAt: string }> }>(
        `/api/customers/deals/${encodeURIComponent(id)}/stage-history?limit=50`,
        undefined,
        { errorMessage: t('customers.deals.detail.stageHistoryError', 'Failed to load stage history.') },
      )
      return payload as { data: Array<{ id: string; fromStageLabel: string | null; toStageLabel: string; durationSeconds: number | null; createdAt: string }> }
    },
  })

  type NextActivity = {
    id: string
    subject: string | null
    activityType: string
    dueAt: string | null
    isOverdue: boolean
    assignedToUserId: string | null
  }

  const nextActivityQuery = useQuery<NextActivity | null>({
    queryKey: ['customers', 'deals', id, 'next-activity', `scope:${scopeVersion}`],
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: Array<Record<string, unknown>> }>(
        `/api/customers/activities?dealId=${encodeURIComponent(id)}&hasSchedule=true&sortField=dueAt&sortDir=asc&pageSize=1`,
        undefined,
        { errorMessage: '' },
      )
      const items = payload?.items
      if (!Array.isArray(items) || !items.length) return null
      const item = items[0]
      return {
        id: String(item.id ?? ''),
        subject: typeof item.subject === 'string' ? item.subject : null,
        activityType: String(item.activityType ?? ''),
        dueAt: typeof item.dueAt === 'string' ? item.dueAt : null,
        isOverdue: item.isOverdue === true,
        assignedToUserId: typeof item.assignedToUserId === 'string' ? item.assignedToUserId : null,
      }
    },
  })

  type DealLineItem = {
    id: string
    lineNumber: number
    name: string
    sku: string | null
    quantity: number
    unitPrice: number
    discountPercent: number | null
    discountAmount: number | null
    taxRate: number | null
    lineTotal: number
    currency: string | null
    productId: string | null
  }

  type DealLineTotals = {
    subtotal: number
    discountTotal: number
    taxTotal: number
    grandTotal: number
    currency: string | null
  }

  const dealLinesQuery = useQuery<{ items: DealLineItem[]; totals: DealLineTotals }>({
    queryKey: ['customers', 'deals', id, 'lines', `scope:${scopeVersion}`, reloadToken],
    enabled: activeTab === 'products' && !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: DealLineItem[]; totals: DealLineTotals }>(
        `/api/customers/deals/${encodeURIComponent(id)}/lines`,
        undefined,
        { errorMessage: t('customers.deals.detail.productsLoadError', 'Failed to load deal products.') },
      )
      return payload as { items: DealLineItem[]; totals: DealLineTotals }
    },
  })

  type DealEmailItem = {
    id: string
    direction: string
    fromAddress: string
    fromName: string | null
    toAddresses: Array<{ email: string; name?: string }>
    subject: string
    bodyText: string | null
    sentAt: string
    hasAttachments: boolean
    isRead: boolean
  }

  const emailsQuery = useQuery<{ items: DealEmailItem[]; total: number }>({
    queryKey: ['customers', 'deals', id, 'emails', `scope:${scopeVersion}`],
    enabled: activeTab === 'emails' && !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: DealEmailItem[]; total: number }>(
        `/api/customers/deals/${encodeURIComponent(id)}/emails?pageSize=50`,
        undefined,
        { errorMessage: t('customers.deals.detail.emails.loadError', 'Failed to load emails.') },
      )
      return payload as { items: DealEmailItem[]; total: number }
    },
  })

  const [showAddLineForm, setShowAddLineForm] = React.useState(false)
  const [newLineName, setNewLineName] = React.useState('')
  const [newLineQty, setNewLineQty] = React.useState('1')
  const [newLinePrice, setNewLinePrice] = React.useState('')

  const addLineMutation = useMutation({
    mutationFn: async (lineData: { name: string; quantity: number; unitPrice: number }) => {
      const result = await apiCallOrThrow(
        `/api/customers/deals/${encodeURIComponent(id)}/lines`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(lineData),
        },
        { errorMessage: t('customers.deals.detail.productsCreateError', 'Failed to add product line.') },
      )
      return result
    },
    onSuccess: () => {
      flash(t('customers.deals.detail.productsCreateSuccess', 'Product line added.'), 'success')
      setShowAddLineForm(false)
      setNewLineName('')
      setNewLineQty('1')
      setNewLinePrice('')
      setReloadToken((token) => token + 1)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : t('customers.deals.detail.productsCreateError', 'Failed to add product line.')
      flash(message, 'error')
    },
  })

  const deleteLineMutation = useMutation({
    mutationFn: async (lineId: string) => {
      await apiCallOrThrow(
        `/api/customers/deals/${encodeURIComponent(id)}/lines`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: lineId }),
        },
        { errorMessage: t('customers.deals.detail.productsDeleteError', 'Failed to remove product line.') },
      )
    },
    onSuccess: () => {
      flash(t('customers.deals.detail.productsDeleteSuccess', 'Product line removed.'), 'success')
      setReloadToken((token) => token + 1)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : t('customers.deals.detail.productsDeleteError', 'Failed to remove product line.')
      flash(message, 'error')
    },
  })

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
  const statusDictEntry = data.deal.status ? statusDictionaryMap?.[data.deal.status] ?? null : null
  const pipelineLabel = resolveDictionaryLabel(data.deal.pipelineStage, pipelineDictionaryMap)
  const pipelineDictEntry = data.deal.pipelineStage ? pipelineDictionaryMap?.[data.deal.pipelineStage] ?? null : null
  const previewValueAmount = formatCurrency(data.deal.valueAmount, data.deal.valueCurrency)
  const previewProbability = data.deal.probability !== null && data.deal.probability !== undefined
    ? `${data.deal.probability}%`
    : null
  const dealPreviewMetadata: Record<string, string> = {}
  if (previewValueAmount) dealPreviewMetadata[t('customers.deals.detail.fields.value')] = previewValueAmount
  if (previewProbability) dealPreviewMetadata[t('customers.deals.detail.fields.probability')] = previewProbability

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
              <>
                <SendObjectMessageDialog
                  object={{
                    entityModule: 'customers',
                    entityType: 'deal',
                    entityId: data.deal.id,
                    sourceEntityType: 'customers.deal',
                    sourceEntityId: data.deal.id,
                    previewData: {
                      title: data.deal.title || t('customers.deals.detail.untitled', 'Untitled deal'),
                      status: data.deal.status ? statusLabel : undefined,
                      metadata: Object.keys(dealPreviewMetadata).length > 0 ? dealPreviewMetadata : undefined,
                    },
                  }}
                  viewHref={`/backend/customers/deals/${data.deal.id}`}
                  defaultValues={{
                    sourceEntityType: 'customers.deal',
                    sourceEntityId: data.deal.id,
                  }}
                />
                <DealTimelineAction dealId={data.deal.id} t={t} />
                <VersionHistoryAction
                  config={{ resourceKind: 'customers.deal', resourceId: data.deal.id }}
                  t={t}
                />
              </>
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
                    {data.lineCount > 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        {t('customers.deals.detail.valueFromLines', 'Computed from {count} product line(s)', { count: data.lineCount })}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.probability', 'Probability')}
                    </p>
                    <p className="text-base font-semibold text-foreground">{probabilityLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.status', 'Status')}
                    </p>
                    <p className="text-base text-foreground flex items-center gap-2">
                      {statusDictEntry?.color ? renderDictionaryColor(statusDictEntry.color) : null}
                      {statusDictEntry?.icon ? renderDictionaryIcon(statusDictEntry.icon) : null}
                      {statusLabel}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.pipeline', 'Pipeline stage')}
                    </p>
                    <p className="text-base text-foreground flex items-center gap-2">
                      {pipelineDictEntry?.color ? renderDictionaryColor(pipelineDictEntry.color) : null}
                      {pipelineDictEntry?.icon ? renderDictionaryIcon(pipelineDictEntry.icon) : null}
                      {pipelineLabel ?? t('customers.deals.detail.noValue', 'Not provided')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.expectedClose', 'Expected close')}
                    </p>
                    <p className="text-base text-foreground">{expectedCloseLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t('customers.deals.detail.fields.nextActivity', 'Next activity')}
                    </p>
                    {nextActivityQuery.data ? (
                      <div className="flex items-center gap-2">
                        <p className="text-base text-foreground">
                          {nextActivityQuery.data.subject ?? nextActivityQuery.data.activityType}
                        </p>
                        {nextActivityQuery.data.isOverdue ? (
                          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                            {t('customers.deals.detail.overdue', 'Overdue')}
                          </span>
                        ) : null}
                        {nextActivityQuery.data.dueAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(nextActivityQuery.data.dueAt, '')}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-base text-muted-foreground">
                        {t('customers.deals.detail.noNextActivity', 'None scheduled')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    {tabs.map((tab) => (
                      <Button
                        key={tab.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveTab(tab.id)}
                        className={`h-auto rounded-none border-b-2 px-0 py-1 ${
                          activeTab === tab.id
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-transparent'
                        }`}
                      >
                        {tab.label}
                      </Button>
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
                {activeTab === 'products' ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">
                        {t('customers.deals.detail.products.title', 'Product lines')}
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddLineForm(true)}
                        disabled={showAddLineForm}
                      >
                        {t('customers.deals.detail.products.add', 'Add line')}
                      </Button>
                    </div>
                    {showAddLineForm ? (
                      <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                        <input
                          type="text"
                          className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
                          placeholder={t('customers.deals.detail.products.namePlaceholder', 'Product name')}
                          value={newLineName}
                          onChange={(e) => setNewLineName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                              e.preventDefault()
                              const qty = Number(newLineQty) || 1
                              const price = Number(newLinePrice) || 0
                              if (newLineName.trim()) {
                                addLineMutation.mutate({ name: newLineName.trim(), quantity: qty, unitPrice: price })
                              }
                            }
                            if (e.key === 'Escape') {
                              setShowAddLineForm(false)
                              setNewLineName('')
                            }
                          }}
                        />
                        <div className="flex gap-2">
                          <input
                            type="number"
                            className="h-8 w-24 rounded border border-border bg-background px-2 text-sm"
                            placeholder={t('customers.deals.detail.products.qtyPlaceholder', 'Qty')}
                            value={newLineQty}
                            onChange={(e) => setNewLineQty(e.target.value)}
                            min={0}
                            step="any"
                          />
                          <input
                            type="number"
                            className="h-8 w-32 rounded border border-border bg-background px-2 text-sm"
                            placeholder={t('customers.deals.detail.products.pricePlaceholder', 'Unit price')}
                            value={newLinePrice}
                            onChange={(e) => setNewLinePrice(e.target.value)}
                            min={0}
                            step="any"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={!newLineName.trim() || addLineMutation.isPending}
                            onClick={() => {
                              const qty = Number(newLineQty) || 1
                              const price = Number(newLinePrice) || 0
                              addLineMutation.mutate({ name: newLineName.trim(), quantity: qty, unitPrice: price })
                            }}
                          >
                            {addLineMutation.isPending
                              ? t('customers.deals.detail.products.creating', 'Adding...')
                              : t('customers.deals.detail.products.create', 'Add')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowAddLineForm(false); setNewLineName('') }}
                          >
                            {t('customers.deals.detail.products.cancel', 'Cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {dealLinesQuery.isLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Spinner className="h-5 w-5" />
                      </div>
                    ) : dealLinesQuery.isError ? (
                      <p className="py-4 text-sm text-destructive">
                        {t('customers.deals.detail.productsLoadError', 'Failed to load deal products.')}
                      </p>
                    ) : !dealLinesQuery.data?.items?.length ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {t('customers.deals.detail.products.empty', 'No product lines added yet.')}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs text-muted-foreground">
                              <th className="py-2 pr-3">#</th>
                              <th className="py-2 pr-3">{t('customers.deals.detail.products.col.name', 'Product')}</th>
                              <th className="py-2 pr-3 text-right">{t('customers.deals.detail.products.col.qty', 'Qty')}</th>
                              <th className="py-2 pr-3 text-right">{t('customers.deals.detail.products.col.price', 'Unit price')}</th>
                              <th className="py-2 pr-3 text-right">{t('customers.deals.detail.products.col.discount', 'Discount')}</th>
                              <th className="py-2 pr-3 text-right">{t('customers.deals.detail.products.col.tax', 'Tax')}</th>
                              <th className="py-2 pr-3 text-right">{t('customers.deals.detail.products.col.total', 'Total')}</th>
                              <th className="py-2 w-8" />
                            </tr>
                          </thead>
                          <tbody>
                            {dealLinesQuery.data.items.map((line, idx) => (
                              <tr key={line.id} className="border-b border-border/50 hover:bg-muted/30">
                                <td className="py-2 pr-3 text-muted-foreground">{idx + 1}</td>
                                <td className="py-2 pr-3">
                                  <div className="flex flex-col">
                                    <span className="font-medium">{line.name}</span>
                                    {line.sku ? <span className="text-xs text-muted-foreground">{line.sku}</span> : null}
                                  </div>
                                </td>
                                <td className="py-2 pr-3 text-right">{line.quantity}</td>
                                <td className="py-2 pr-3 text-right">{formatCurrency(String(line.unitPrice), line.currency) ?? String(line.unitPrice)}</td>
                                <td className="py-2 pr-3 text-right text-muted-foreground">
                                  {line.discountPercent ? `${line.discountPercent}%` : line.discountAmount ? formatCurrency(String(line.discountAmount), line.currency) : '-'}
                                </td>
                                <td className="py-2 pr-3 text-right text-muted-foreground">
                                  {line.taxRate !== null && line.taxRate !== undefined ? `${line.taxRate}%` : '-'}
                                </td>
                                <td className="py-2 pr-3 text-right font-medium">{formatCurrency(String(line.lineTotal), line.currency) ?? String(line.lineTotal)}</td>
                                <td className="py-2">
                                  <button
                                    type="button"
                                    className="text-xs text-destructive hover:underline disabled:opacity-50"
                                    disabled={deleteLineMutation.isPending}
                                    onClick={() => deleteLineMutation.mutate(line.id)}
                                  >
                                    {t('customers.deals.detail.products.remove', 'Remove')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-3 flex flex-col items-end gap-1 text-sm">
                          <div className="flex gap-8">
                            <span className="text-muted-foreground">{t('customers.deals.detail.products.subtotal', 'Subtotal')}</span>
                            <span className="font-medium">{formatCurrency(String(dealLinesQuery.data.totals.subtotal), dealLinesQuery.data.totals.currency) ?? String(dealLinesQuery.data.totals.subtotal)}</span>
                          </div>
                          {dealLinesQuery.data.totals.discountTotal > 0 ? (
                            <div className="flex gap-8">
                              <span className="text-muted-foreground">{t('customers.deals.detail.products.discountTotal', 'Discounts')}</span>
                              <span className="text-destructive">-{formatCurrency(String(dealLinesQuery.data.totals.discountTotal), dealLinesQuery.data.totals.currency)}</span>
                            </div>
                          ) : null}
                          {dealLinesQuery.data.totals.taxTotal > 0 ? (
                            <div className="flex gap-8">
                              <span className="text-muted-foreground">{t('customers.deals.detail.products.taxTotal', 'Tax')}</span>
                              <span>{formatCurrency(String(dealLinesQuery.data.totals.taxTotal), dealLinesQuery.data.totals.currency)}</span>
                            </div>
                          ) : null}
                          <div className="flex gap-8 border-t border-border pt-1">
                            <span className="font-semibold">{t('customers.deals.detail.products.grandTotal', 'Grand total')}</span>
                            <span className="font-semibold">{formatCurrency(String(dealLinesQuery.data.totals.grandTotal), dealLinesQuery.data.totals.currency) ?? String(dealLinesQuery.data.totals.grandTotal)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
                {activeTab === 'stage-history' ? (
                  <div className="mt-4 space-y-3">
                    {stageHistoryQuery.isLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Spinner className="h-5 w-5" />
                      </div>
                    ) : stageHistoryQuery.isError ? (
                      <p className="py-4 text-sm text-destructive">
                        {t('customers.deals.detail.stageHistoryError', 'Failed to load stage history.')}
                      </p>
                    ) : !stageHistoryQuery.data?.data?.length ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {t('customers.deals.detail.stageHistoryEmpty', 'No stage transitions recorded yet.')}
                      </p>
                    ) : (
                      <div className="relative space-y-0 border-l-2 border-border pl-6">
                        {stageHistoryQuery.data.data.map((entry) => {
                          const durationLabel = entry.durationSeconds !== null && entry.durationSeconds > 0
                            ? entry.durationSeconds >= 86400
                              ? `${Math.round(entry.durationSeconds / 86400)}d`
                              : entry.durationSeconds >= 3600
                                ? `${Math.round(entry.durationSeconds / 3600)}h`
                                : `${Math.round(entry.durationSeconds / 60)}m`
                            : null
                          return (
                            <div key={entry.id} className="relative pb-4">
                              <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-primary bg-background" />
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2 text-sm">
                                  {entry.fromStageLabel ? (
                                    <>
                                      <span className="text-muted-foreground">{entry.fromStageLabel}</span>
                                      <span className="text-muted-foreground">&rarr;</span>
                                    </>
                                  ) : null}
                                  <span className="font-medium text-foreground">{entry.toStageLabel}</span>
                                  {durationLabel ? (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {durationLabel}
                                    </span>
                                  ) : null}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(entry.createdAt, '')}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
                {activeTab === 'files' ? (
                  <div className="mt-4">
                    <AttachmentsSection
                      entityId="customers:customer_deal"
                      recordId={data.deal.id}
                      title={t('customers.deals.detail.files.title', 'Deal files')}
                      description={t('customers.deals.detail.files.description', 'Upload and manage files related to this deal.')}
                    />
                  </div>
                ) : null}
                {activeTab === 'emails' ? (
                  <div className="mt-4 space-y-3">
                    {emailsQuery.isLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Spinner className="h-5 w-5" />
                      </div>
                    ) : emailsQuery.isError ? (
                      <p className="py-4 text-sm text-destructive">
                        {t('customers.deals.detail.emails.loadError', 'Failed to load emails.')}
                      </p>
                    ) : !emailsQuery.data?.items?.length ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {t('customers.deals.detail.emails.empty', 'No emails logged on this deal yet.')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {emailsQuery.data.items.map((email) => (
                          <div
                            key={email.id}
                            className={`rounded-md border p-3 ${!email.isRead ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    email.direction === 'inbound'
                                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                  }`}>
                                    {email.direction === 'inbound'
                                      ? t('customers.deals.detail.emails.inbound', 'Received')
                                      : t('customers.deals.detail.emails.outbound', 'Sent')}
                                  </span>
                                  <span className="text-sm font-medium text-foreground truncate">{email.subject}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {email.direction === 'inbound'
                                    ? t('customers.deals.detail.emails.from', 'From: {address}', { address: email.fromName ?? email.fromAddress })
                                    : t('customers.deals.detail.emails.to', 'To: {address}', { address: email.toAddresses.map((r) => r.name ?? r.email).join(', ') })}
                                </p>
                                {email.bodyText ? (
                                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{email.bodyText}</p>
                                ) : null}
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                                {formatDate(email.sentAt, '')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
                    <ul className="space-y-3 text-sm">
                      {data.people.map((person) => (
                        <li key={person.id} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Link href={`/backend/customers/people/${encodeURIComponent(person.id)}`} className="font-medium text-foreground hover:underline">
                              {person.label}
                            </Link>
                            {person.role ? (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                {contactRoleOptions.find((opt) => opt.value === person.role)?.label ?? person.role}
                              </span>
                            ) : null}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {person.subtitle ?? t('customers.deals.detail.peopleNoDetails', 'No additional details')}
                          </span>
                          <select
                            className="mt-1 h-7 w-40 rounded border border-border bg-background px-2 text-xs text-foreground"
                            value={person.role ?? ''}
                            onChange={(e) => {
                              const nextRole = e.target.value || null
                              updateContactRoleMutation.mutate({ personId: person.id, role: nextRole })
                            }}
                            disabled={updateContactRoleMutation.isPending}
                          >
                            <option value="">{t('customers.deals.detail.contactRole.none', 'No role')}</option>
                            {contactRoleOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
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
                    pipelineId: data.deal.pipelineId ?? '',
                    pipelineStageId: data.deal.pipelineStageId ?? '',
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
