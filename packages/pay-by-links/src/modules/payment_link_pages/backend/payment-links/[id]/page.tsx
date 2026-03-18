"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import { Copy, ExternalLink, ArrowLeft } from 'lucide-react'

const paymentLinkEditSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(['active', 'completed', 'cancelled']),
  maxUses: z.coerce.number().int().positive().optional().nullable(),
})

type PaymentLinkEditValues = z.infer<typeof paymentLinkEditSchema>

type PaymentLinkRecord = {
  id: string
  token: string
  title: string
  description: string | null
  providerKey: string
  status: string
  transactionId: string | null
  amount: number | null
  currencyCode: string | null
  linkMode: string
  maxUses: number | null
  useCount: number
  passwordProtected: boolean
  metadata: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

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

function parseRecord(item: Record<string, unknown>): PaymentLinkRecord {
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

export default function PaymentLinkEditPage({ params }: { params: { id: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [record, setRecord] = React.useState<PaymentLinkRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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

  const fields = React.useMemo(() => [
    { id: 'title', label: t('payment_gateways.links.edit.title', 'Title'), type: 'text' as const, required: true },
    { id: 'description', label: t('payment_gateways.links.edit.description', 'Description'), type: 'textarea' as const },
    {
      id: 'status',
      label: t('payment_gateways.links.edit.status', 'Status'),
      type: 'select' as const,
      required: true,
      layout: 'half' as const,
      options: [
        { value: 'active', label: t('payment_gateways.links.edit.status.active', 'Active') },
        { value: 'completed', label: t('payment_gateways.links.edit.status.completed', 'Completed') },
        { value: 'cancelled', label: t('payment_gateways.links.edit.status.cancelled', 'Cancelled') },
      ],
    },
    {
      id: 'maxUses',
      label: t('payment_gateways.links.edit.maxUses', 'Maximum uses'),
      type: 'number' as const,
      layout: 'half' as const,
      description: t('payment_gateways.links.edit.maxUses.description', 'Leave empty for unlimited'),
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    // Column 1: editable fields
    {
      id: 'general',
      column: 1,
      title: t('payment_gateways.links.edit.group.general', 'Link Settings'),
      fields: ['title', 'description', 'status', 'maxUses'],
    },
    // Column 2: readonly details
    {
      id: 'details',
      column: 2,
      title: t('payment_gateways.links.detail.sections.details', 'Link Details'),
      bare: true,
      component: () => {
        if (!record) return null
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
              <Button type="button" variant="outline" size="sm" onClick={() => { void handleCopyLink() }}>
                <Copy className="mr-2 h-4 w-4" />
                {t('payment_gateways.links.detail.copyLink', 'Copy link')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { if (record) window.open(`/pay/${record.token}`, '_blank') }}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('payment_gateways.links.detail.openLink', 'Open link')}
              </Button>
            </div>
          </div>
        )
      },
    },
    // Column 2: custom fields
    {
      id: 'custom-fields',
      column: 2,
      title: t('payment_gateways.links.edit.group.customFields', 'Custom fields'),
      kind: 'customFields' as const,
    },
  ], [t, record, locale, handleCopyLink])

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

  const initialValues: PaymentLinkEditValues = {
    title: record.title,
    description: record.description,
    status: (record.status as 'active' | 'completed' | 'cancelled') ?? 'active',
    maxUses: record.maxUses,
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<PaymentLinkEditValues>
          title={`${record.title} (${record.status})`}
          backHref="/backend/payment-links"
          cancelHref="/backend/payment-links"
          fields={fields}
          groups={groups}
          twoColumn
          schema={paymentLinkEditSchema}
          initialValues={initialValues}
          entityIds={[PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]}
          customFieldsetBindings={{ [PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]: { valueKey: 'customFieldsetCode' } }}
          submitLabel={t('payment_gateways.links.edit.submit', 'Save Payment Link')}
          onSubmit={async (values) => {
            await apiCallOrThrow(
              '/api/payment_gateways/payment-links',
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: record.id,
                  title: values.title,
                  description: values.description || null,
                  status: values.status,
                  maxUses: values.maxUses || null,
                }),
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
