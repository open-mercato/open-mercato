"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Copy, ExternalLink, ArrowLeft, AlertTriangle } from 'lucide-react'
import {
  paymentLinkEditSchema,
  buildPaymentLinkEditFields,
  buildPaymentLinkEditGroups,
  buildNotificationFields,
  buildNotificationGroups,
  recordToPaymentLinkEditFormValues,
  paymentLinkEditFormToPayload,
  type PaymentLinkEditFormValues,
  type PaymentLinkApiRecord,
} from '../../../components/paymentLinkFormConfig'

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active': return 'default'
    case 'completed': return 'secondary'
    case 'cancelled': return 'destructive'
    default: return 'outline'
  }
}

function formatAmount(amount: number | null, currency: string | null, locale: string): string {
  if (amount == null || !currency) return '\u2014'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function formatDate(dateStr: string | null, locale: string): string {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleString(locale)
  } catch {
    return dateStr
  }
}

function parseRecord(item: Record<string, unknown>): PaymentLinkApiRecord {
  return {
    id: String(item.id ?? ''),
    token: String(item.token ?? ''),
    title: String(item.title ?? ''),
    description: item.description != null ? String(item.description) : null,
    providerKey: String(item.providerKey ?? ''),
    status: String(item.status ?? 'active'),
    transactionId: item.transactionId != null ? String(item.transactionId) : null,
    amount: typeof item.amount === 'number' ? item.amount : null,
    currencyCode: typeof item.currencyCode === 'string' ? item.currencyCode : null,
    linkMode: String(item.linkMode ?? 'single'),
    maxUses: typeof item.maxUses === 'number' ? item.maxUses : null,
    useCount: typeof item.useCount === 'number' ? item.useCount : 0,
    passwordProtected: item.passwordProtected === true,
    metadata: item.metadata != null && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : null,
    createdAt: item.createdAt != null ? String(item.createdAt) : null,
    updatedAt: item.updatedAt != null ? String(item.updatedAt) : null,
  }
}

function isLinkEditable(record: PaymentLinkApiRecord): { editable: boolean; reason: string } {
  if (record.linkMode === 'single' && record.status === 'completed') {
    return { editable: false, reason: 'This single-use payment link has been completed and cannot be edited.' }
  }
  if (record.linkMode === 'single' && record.transactionId) {
    return { editable: false, reason: 'This single-use payment link has an active transaction and cannot be modified.' }
  }
  return { editable: true, reason: '' }
}

function DetailsPanel({
  record,
  locale,
  t,
  onCopyLink,
}: {
  record: PaymentLinkApiRecord
  locale: string
  t: (key: string, fallback?: string) => string
  onCopyLink: () => void
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <h3 className="mb-3 text-sm font-semibold">{t('payment_gateways.links.detail.sections.details', 'Link Details')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.token', 'Token')}</p>
          <p className="font-mono text-xs">{record.token}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.provider', 'Provider')}</p>
          <p className="text-sm capitalize">{record.providerKey}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.amount', 'Amount')}</p>
          <p className="text-sm">{formatAmount(record.amount, record.currencyCode, locale)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.linkMode', 'Link Mode')}</p>
          <p className="text-sm">{record.linkMode}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.useCount', 'Use Count')}</p>
          <p className="text-sm">{String(record.useCount)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.passwordProtected', 'Password')}</p>
          <p className="text-sm">{record.passwordProtected ? t('payment_gateways.links.detail.yes', 'Yes') : t('payment_gateways.links.detail.no', 'No')}</p>
        </div>
        {record.transactionId ? (
          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.transaction', 'Transaction')}</p>
            <Link
              href={`/backend/payment-gateways?txn=${encodeURIComponent(record.transactionId)}`}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              {record.transactionId}
            </Link>
          </div>
        ) : null}
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.createdAt', 'Created')}</p>
          <p className="text-sm">{formatDate(record.createdAt, locale)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('payment_gateways.links.detail.fields.updatedAt', 'Updated')}</p>
          <p className="text-sm">{formatDate(record.updatedAt, locale)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCopyLink}>
          <Copy className="mr-2 h-4 w-4" />
          {t('payment_gateways.links.detail.copyLink', 'Copy link')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => window.open(`/pay/${record.token}`, '_blank')}>
          <ExternalLink className="mr-2 h-4 w-4" />
          {t('payment_gateways.links.detail.openLink', 'Open link')}
        </Button>
      </div>
    </div>
  )
}

type TransactionRowBrief = {
  id: string
  paymentId: string
  providerKey: string
  unifiedStatus: string
  amount: string
  currencyCode: string
  createdAt: string | null
}

const TXN_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-800',
  authorized: 'bg-blue-100 text-blue-800',
  captured: 'bg-green-100 text-green-800',
  partially_captured: 'bg-emerald-100 text-emerald-800',
  refunded: 'bg-amber-100 text-amber-800',
  partially_refunded: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-zinc-200 text-zinc-900',
  failed: 'bg-red-100 text-red-800',
  expired: 'bg-neutral-200 text-neutral-900',
}

function TransactionsPanel({
  linkId,
  locale,
  t,
}: {
  linkId: string
  locale: string
  t: (key: string, fallback?: string) => string
}) {
  const [transactions, setTransactions] = React.useState<TransactionRowBrief[]>([])
  const [loading, setLoading] = React.useState(true)
  const [total, setTotal] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const params = new URLSearchParams({
        entityType: 'payment_link_pages:gateway_payment_link',
        entityId: linkId,
        pageSize: '20',
      })
      const call = await apiCall<{ items: TransactionRowBrief[]; total: number }>(
        `/api/payment_gateways/transactions?${params.toString()}`,
        undefined,
        { fallback: { items: [], total: 0 } },
      )
      if (cancelled) return
      if (call.ok && call.result) {
        setTransactions(Array.isArray(call.result.items) ? call.result.items : [])
        setTotal(call.result.total ?? 0)
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [linkId])

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <h3 className="mb-3 text-sm font-semibold">
        {t('payment_gateways.links.detail.sections.transactions', 'Transactions')}
        {!loading && total > 0 ? <span className="ml-2 text-xs font-normal text-muted-foreground">({total})</span> : null}
      </h3>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('payment_gateways.links.detail.loadingTransactions', 'Loading transactions…')}
        </div>
      ) : transactions.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {t('payment_gateways.links.detail.noTransactions', 'No transactions found for this payment link.')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.paymentId', 'Payment')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.status', 'Status')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.amount', 'Amount')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.createdAt', 'Created')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/backend/payment-gateways?txn=${encodeURIComponent(txn.id)}`}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {txn.paymentId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className={TXN_STATUS_STYLES[txn.unifiedStatus] ?? ''}>
                      {txn.unifiedStatus}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{formatAmount(Number(txn.amount), txn.currencyCode, locale)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(txn.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type EditTab = 'general' | 'notifications'

export default function PaymentLinkEditPage({ params }: { params: { id: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [record, setRecord] = React.useState<PaymentLinkApiRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [extraValues, setExtraValues] = React.useState<Partial<PaymentLinkEditFormValues>>({})
  const [activeTab, setActiveTab] = React.useState<EditTab>('general')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/payment_gateways/payment-links?id=${encodeURIComponent(params.id)}&pageSize=1`
        )
        if (cancelled) return
        const item = response.items?.[0]
        if (!item) {
          setError(t('payment_gateways.links.detail.notFound', 'Payment link not found'))
          return
        }
        setRecord(parseRecord(item))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('payment_gateways.links.detail.loadError', 'Failed to load payment link'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [params.id, t])

  const handleCopyLink = React.useCallback(async () => {
    if (!record) return
    const publicUrl = `${window.location.origin}/pay/${record.token}`
    try {
      await navigator.clipboard.writeText(publicUrl)
      flash(t('payment_gateways.create.linkCopied', 'Link copied to clipboard'), 'success')
    } catch {
      flash(t('payment_gateways.create.copyFailed', 'Failed to copy link'), 'error')
    }
  }, [record, t])

  const handleLogoFileSelect = React.useCallback(async (file: File) => {
    const fd = new FormData()
    fd.set('file', file)
    fd.set('entityId', 'payment_link_pages:branding')
    fd.set('recordId', 'logo-upload')
    try {
      const call = await apiCallOrThrow<{ item?: { url?: string } }>('/api/attachments', {
        method: 'POST',
        body: fd,
      })
      const url = call.result?.item?.url
      if (url) {
        setExtraValues(prev => ({ ...prev, brandingLogoUrl: url }))
        setFormResetKey(k => k + 1)
        flash(t('payment_link_pages.create.branding.logoUploaded', 'Logo uploaded'), 'success')
      }
    } catch {
      flash(t('payment_link_pages.create.branding.logoUploadError', 'Failed to upload logo'), 'error')
    }
  }, [t])

  const fields = React.useMemo(
    () => [
      ...buildPaymentLinkEditFields(t, {
        onLogoFileSelect: handleLogoFileSelect,
        passwordProtected: record?.passwordProtected,
      }),
      ...buildNotificationFields(t),
    ],
    [t, handleLogoFileSelect, record?.passwordProtected],
  )

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    if (activeTab === 'notifications') {
      return buildNotificationGroups(t)
    }
    const baseGroups = buildPaymentLinkEditGroups(t)
    const detailsGroup: CrudFormGroup = {
      id: 'details',
      column: 2,
      bare: true,
      component: () => {
        if (!record) return null
        return <DetailsPanel record={record} locale={locale} t={t} onCopyLink={() => { void handleCopyLink() }} />
      },
    }
    const transactionsGroup: CrudFormGroup = {
      id: 'transactions',
      column: 2,
      bare: true,
      component: () => {
        if (!record) return null
        return <TransactionsPanel linkId={record.id} locale={locale} t={t} />
      },
    }
    const customFieldsIdx = baseGroups.findIndex(g => g.id === 'custom-fields')
    const withDetails = [...baseGroups]
    withDetails.splice(customFieldsIdx >= 0 ? customFieldsIdx : baseGroups.length, 0, detailsGroup, transactionsGroup)
    return withDetails
  }, [t, record, locale, handleCopyLink, activeTab])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('payment_gateways.links.detail.loading', 'Loading payment link...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error ?? t('payment_gateways.links.detail.notFound', 'Payment link not found')}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/backend/payment-links">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('payment_gateways.links.detail.backToList', 'Back to Payment Links')}
                </Link>
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  const { editable, reason } = isLinkEditable(record)

  if (!editable) {
    return (
      <Page>
        <PageBody>
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/backend/payment-links">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('payment_gateways.links.detail.backToList', 'Back to Payment Links')}
                </Link>
              </Button>
            </div>
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{reason}</p>
              </div>
            </div>
            <div className="rounded-lg border p-6">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold">{record.title}</h2>
                <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
              </div>
              <DetailsPanel record={record} locale={locale} t={t} onCopyLink={() => { void handleCopyLink() }} />
            </div>
            <TransactionsPanel linkId={record.id} locale={locale} t={t} />
          </div>
        </PageBody>
      </Page>
    )
  }

  const initialValues: PaymentLinkEditFormValues = {
    ...recordToPaymentLinkEditFormValues(record),
    ...extraValues,
  }

  const tabs: { id: EditTab; label: string }[] = [
    { id: 'general', label: t('payment_link_pages.edit.tabs.general', 'General') },
    { id: 'notifications', label: t('payment_link_pages.edit.tabs.notifications', 'Notifications') },
  ]

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <nav className="flex items-center gap-3 text-sm" role="tablist" aria-label={t('payment_link_pages.edit.tabs.label', 'Edit payment link tabs')}>
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={
                  activeTab === tab.id
                    ? 'h-auto rounded-none border-b-2 border-primary px-0 py-1 text-foreground'
                    : 'h-auto rounded-none border-b-2 border-transparent px-0 py-1 text-muted-foreground hover:text-foreground hover:bg-transparent'
                }
              >
                {tab.label}
              </Button>
            ))}
          </nav>
        </div>
        <CrudForm<PaymentLinkEditFormValues>
          key={`${formResetKey}-${activeTab}`}
          title={`${t('payment_gateways.links.edit.title', 'Edit Payment Link')}: ${record.title}`}
          backHref="/backend/payment-links"
          cancelHref="/backend/payment-links"
          fields={fields}
          groups={groups}
          twoColumn={activeTab === 'general'}
          schema={paymentLinkEditSchema}
          initialValues={initialValues}
          entityIds={activeTab === 'general' ? [PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID] : []}
          customFieldsetBindings={activeTab === 'general' ? { [PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]: { valueKey: 'customFieldsetCode' } } : {}}
          submitLabel={t('payment_gateways.links.edit.submit', 'Save Payment Link')}
          onSubmit={async (values) => {
            const customFieldPayload = collectCustomFieldValues(values as Record<string, unknown>)
            const payload = paymentLinkEditFormToPayload(values, record.id)
            if (Object.keys(customFieldPayload).length > 0) {
              payload.customFields = customFieldPayload
            }
            await apiCallOrThrow(
              '/api/payment_gateways/payment-links',
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              },
              { errorMessage: t('payment_gateways.links.edit.error', 'Failed to update payment link') },
            )
            flash(t('payment_gateways.links.edit.success', 'Payment link updated'), 'success')
            router.push('/backend/payment-links')
          }}
        />
      </PageBody>
    </Page>
  )
}
