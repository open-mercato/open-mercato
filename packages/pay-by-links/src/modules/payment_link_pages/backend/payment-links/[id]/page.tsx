"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { LoadingMessage, ErrorMessage, CustomDataSection } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import { Copy, ExternalLink, ArrowLeft } from 'lucide-react'

type PaymentLinkDetail = {
  id: string
  token: string
  title: string
  description?: string | null
  providerKey: string
  status: string
  transactionId?: string | null
  amount: number | null
  currencyCode: string | null
  linkMode: string
  maxUses: number | null
  useCount: number
  passwordProtected: boolean
  metadata: Record<string, unknown> | null
  customFields: Record<string, unknown>
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

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

export default function PaymentLinkDetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const locale = useLocale()
  const [record, setRecord] = React.useState<PaymentLinkDetail | null>(null)
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
        setRecord({
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
          customFields: item.customFields != null && typeof item.customFields === 'object' ? item.customFields as Record<string, unknown> : {},
          createdAt: item.createdAt != null ? String(item.createdAt) : null,
          updatedAt: item.updatedAt != null ? String(item.updatedAt) : null,
        })
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

  const handleOpenLink = React.useCallback(() => {
    if (!record) return
    window.open(`/pay/${record.token}`, '_blank')
  }, [record])

  const handleCustomFieldsSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (!record) return
      const customPayload = collectCustomFieldValues(values)
      if (!Object.keys(customPayload).length) {
        flash(t('ui.forms.flash.saveSuccess', 'Saved'), 'success')
        return
      }
      await apiCallOrThrow(
        '/api/payment_gateways/payment-links',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: record.id, customFields: customPayload }),
        },
        { errorMessage: t('payment_gateways.links.detail.saveError', 'Failed to save custom fields') },
      )
      const prefixed: Record<string, unknown> = {}
      for (const [fieldId, value] of Object.entries(customPayload)) {
        prefixed[`cf_${fieldId}`] = value
      }
      setRecord((prev) => prev ? { ...prev, customFields: prefixed } : prev)
      flash(t('ui.forms.flash.saveSuccess', 'Saved'), 'success')
    },
    [record, t],
  )

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

  return (
    <Page>
      <PageBody className="space-y-8">
        <FormHeader
          mode="detail"
          backHref="/backend/payment-links"
          title={record.title}
          entityTypeLabel={t('payment_gateways.links.detail.entityType', 'Payment Link')}
          statusBadge={
            <Badge variant={statusVariant(record.status)}>
              {record.status}
            </Badge>
          }
          actionsContent={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopyLink}>
                <Copy className="mr-2 h-4 w-4" />
                {t('payment_gateways.links.detail.copyLink', 'Copy link')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleOpenLink}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('payment_gateways.links.detail.openLink', 'Open link')}
              </Button>
            </div>
          }
        />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            {t('payment_gateways.links.detail.sections.details', 'Link Details')}
          </h2>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label={t('payment_gateways.links.detail.fields.token', 'Token')}>
                <span className="font-mono text-xs">{record.token}</span>
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.provider', 'Provider')}>
                <span className="capitalize">{record.providerKey}</span>
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.status', 'Status')}>
                <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.amount', 'Amount')}>
                {formatAmount(record.amount, record.currencyCode, locale)}
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.currency', 'Currency')}>
                {record.currencyCode ?? '\u2014'}
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.linkMode', 'Link Mode')}>
                {record.linkMode}
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.maxUses', 'Max Uses')}>
                {record.maxUses != null ? String(record.maxUses) : t('payment_gateways.links.detail.unlimited', 'Unlimited')}
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.useCount', 'Use Count')}>
                {String(record.useCount)}
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.passwordProtected', 'Password Protected')}>
                {record.passwordProtected
                  ? t('payment_gateways.links.detail.yes', 'Yes')
                  : t('payment_gateways.links.detail.no', 'No')}
              </DetailField>

              {record.description ? (
                <DetailField label={t('payment_gateways.links.detail.fields.description', 'Description')}>
                  {record.description}
                </DetailField>
              ) : null}

              {record.transactionId ? (
                <DetailField label={t('payment_gateways.links.detail.fields.transaction', 'Transaction')}>
                  <Link
                    href={`/backend/payment-gateways?txn=${encodeURIComponent(record.transactionId)}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {record.transactionId}
                  </Link>
                </DetailField>
              ) : null}

              <DetailField label={t('payment_gateways.links.detail.fields.createdAt', 'Created')}>
                {formatDate(record.createdAt, locale)}
              </DetailField>

              <DetailField label={t('payment_gateways.links.detail.fields.updatedAt', 'Updated')}>
                {formatDate(record.updatedAt, locale)}
              </DetailField>
            </div>
          </div>
        </div>

        <CustomDataSection
          entityIds={[PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]}
          values={record.customFields ?? {}}
          onSubmit={handleCustomFieldsSubmit}
          title={t('payment_gateways.links.detail.sections.customFields', 'Custom Fields')}
          labels={{
            loading: t('payment_gateways.links.detail.customFields.loading', 'Loading custom fields...'),
            emptyValue: t('payment_gateways.links.detail.customFields.emptyValue', 'Not set'),
            noFields: t('payment_gateways.links.detail.customFields.noFields', 'No custom fields defined.'),
            defineFields: t('payment_gateways.links.detail.customFields.defineFields', 'Define fields'),
            saveShortcut: t('payment_gateways.links.detail.customFields.save', 'Save'),
            edit: t('ui.forms.actions.edit', 'Edit'),
            cancel: t('ui.forms.actions.cancel', 'Cancel'),
          }}
        />
      </PageBody>
    </Page>
  )
}
