"use client"

import * as React from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  CircleDollarSign,
  Copy,
  ExternalLink,
  HandCoins,
  Link2,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type DetailPayload = {
  transaction: {
    id: string
    amount?: number | null
    currencyCode: string
    status: string
    paymentStatus?: string | null
    gatewayTransactionId?: string | null
    selectedPriceItemId?: string | null
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    phone?: string | null
    customerData?: Record<string, unknown> | null
    createdAt?: string | null
    updatedAt?: string | null
  }
  link?: {
    id: string
    name: string
    slug: string
    pricingMode: string
  } | null
}

type SectionRow = {
  label: string
  plainValue: string
  value: React.ReactNode
}

type SectionDefinition = {
  id: string
  title: string
  icon: LucideIcon
  rows: SectionRow[]
  footer?: React.ReactNode
  emptyMessage?: string
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border/50 pb-3 last:border-b-0 last:pb-0 md:grid-cols-[180px_1fr]">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm">{value}</div>
    </div>
  )
}

function formatAmount(amount: number | null | undefined, currencyCode: string): string {
  const resolved = typeof amount === 'number' ? amount : 0
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(resolved)
  } catch {
    return `${resolved.toFixed(2)} ${currencyCode}`
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed)
}

function stringifyPlainValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value.trim().length > 0 ? value : '—'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildSectionMarkdown(section: SectionDefinition): string {
  if (section.rows.length === 0) {
    return `## ${section.title}\n\n${section.emptyMessage ?? '—'}`
  }
  return [
    `## ${section.title}`,
    '',
    ...section.rows.map((row) => `- **${row.label}:** ${row.plainValue}`),
  ].join('\n')
}

function buildSectionJson(section: SectionDefinition): string {
  return JSON.stringify({
    section: section.id,
    title: section.title,
    fields: Object.fromEntries(section.rows.map((row) => [row.label, row.plainValue])),
  }, null, 2)
}

export default function CheckoutTransactionDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const t = useT()
  const [payload, setPayload] = React.useState<DetailPayload | null>(null)
  const [transactionId, setTransactionId] = React.useState('')
  const [isCapturing, setIsCapturing] = React.useState(false)
  const { runMutation } = useGuardedMutation<{
    entityType: string
    entityId?: string
  }>({
    contextId: 'checkout:transaction-detail',
  })

  const loadPayload = React.useCallback(async (id: string) => {
    const result = await readApiResultOrThrow<DetailPayload>(`/api/checkout/transactions/${encodeURIComponent(id)}`)
    setPayload(result)
  }, [])

  React.useEffect(() => {
    let active = true
    void Promise.resolve(params)
      .then(async (resolvedParams) => {
        if (!active) return
        setTransactionId(resolvedParams.id)
        const result = await readApiResultOrThrow<DetailPayload>(`/api/checkout/transactions/${encodeURIComponent(resolvedParams.id)}`)
        if (active) setPayload(result)
      })
      .catch(() => {
        if (active) setPayload(null)
      })
    return () => { active = false }
  }, [params])

  const canCapturePayment = payload?.transaction.gatewayTransactionId
    && payload.transaction.paymentStatus === 'authorized'

  const handleCapturePayment = React.useCallback(async () => {
    const gatewayTransactionId = payload?.transaction.gatewayTransactionId
    if (!gatewayTransactionId || !transactionId) return
    setIsCapturing(true)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow('/api/payment_gateways/capture', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ transactionId: gatewayTransactionId }),
          })
        },
        context: {
          entityType: 'checkout:checkout_transaction',
          entityId: transactionId,
        },
        mutationPayload: { transactionId, gatewayTransactionId },
      })
      setPayload((current) => current ? {
        ...current,
        transaction: {
          ...current.transaction,
          paymentStatus: 'captured',
          status: 'completed',
        },
      } : current)
      await loadPayload(transactionId)
      flash(t('checkout.admin.transactionDetail.flash.captured', 'Payment captured.'), 'success')
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : t('checkout.admin.transactionDetail.captureError', 'Failed to capture payment.')
      flash(message, 'error')
    } finally {
      setIsCapturing(false)
    }
  }, [loadPayload, payload?.transaction.gatewayTransactionId, runMutation, t, transactionId])

  const sections = React.useMemo<SectionDefinition[]>(() => {
    if (!payload) return []

    const translatedStatus = t(`checkout.admin.transactions.status.${payload.transaction.status}`, payload.transaction.status)
    const paymentRows: SectionRow[] = [
      {
        label: t('checkout.admin.transactionDetail.fields.amount'),
        plainValue: formatAmount(payload.transaction.amount, payload.transaction.currencyCode),
        value: <span className="font-semibold">{formatAmount(payload.transaction.amount, payload.transaction.currencyCode)}</span>,
      },
      {
        label: t('checkout.admin.transactionDetail.fields.status'),
        plainValue: translatedStatus,
        value: <Badge variant="secondary">{translatedStatus}</Badge>,
      },
      {
        label: t('checkout.admin.transactionDetail.fields.paymentStatus'),
        plainValue: stringifyPlainValue(payload.transaction.paymentStatus),
        value: payload.transaction.paymentStatus ?? t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.transactionId'),
        plainValue: payload.transaction.id,
        value: <span className="break-all font-mono text-xs">{payload.transaction.id}</span>,
      },
      {
        label: t('checkout.admin.transactionDetail.fields.created'),
        plainValue: formatDateTime(payload.transaction.createdAt),
        value: formatDateTime(payload.transaction.createdAt),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.updated'),
        plainValue: formatDateTime(payload.transaction.updatedAt),
        value: formatDateTime(payload.transaction.updatedAt),
      },
    ]

    const linkRows: SectionRow[] = [
      {
        label: t('checkout.admin.transactionDetail.fields.linkName'),
        plainValue: stringifyPlainValue(payload.link?.name),
        value: payload.link?.name ?? t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.slug'),
        plainValue: payload.link ? `/pay/${payload.link.slug}` : '—',
        value: payload.link ? <span className="break-all font-mono text-xs">{`/pay/${payload.link.slug}`}</span> : t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.pricingMode'),
        plainValue: stringifyPlainValue(payload.link?.pricingMode),
        value: payload.link?.pricingMode ?? t('checkout.common.emptyValue'),
      },
    ]

    const customerRows: SectionRow[] = [
      {
        label: t('checkout.admin.transactionDetail.fields.firstName'),
        plainValue: stringifyPlainValue(payload.transaction.firstName),
        value: payload.transaction.firstName ?? t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.lastName'),
        plainValue: stringifyPlainValue(payload.transaction.lastName),
        value: payload.transaction.lastName ?? t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.email'),
        plainValue: stringifyPlainValue(payload.transaction.email),
        value: payload.transaction.email ?? t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.phone'),
        plainValue: stringifyPlainValue(payload.transaction.phone),
        value: payload.transaction.phone ?? t('checkout.common.emptyValue'),
      },
    ]

    const gatewayRows: SectionRow[] = [
      {
        label: t('checkout.admin.transactionDetail.fields.gatewayTransactionId'),
        plainValue: stringifyPlainValue(payload.transaction.gatewayTransactionId),
        value: payload.transaction.gatewayTransactionId
          ? <span className="break-all font-mono text-xs">{payload.transaction.gatewayTransactionId}</span>
          : t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.selectedPriceItem'),
        plainValue: stringifyPlainValue(payload.transaction.selectedPriceItemId),
        value: payload.transaction.selectedPriceItemId ?? t('checkout.common.emptyValue'),
      },
      {
        label: t('checkout.admin.transactionDetail.fields.checkoutTransaction'),
        plainValue: transactionId || '—',
        value: transactionId ? <span className="break-all font-mono text-xs">{transactionId}</span> : t('checkout.common.emptyValue'),
      },
    ]

    const customFieldRows = payload.transaction.customerData
      ? Object.entries(payload.transaction.customerData).map(([key, value]): SectionRow => ({
          label: key,
          plainValue: stringifyPlainValue(value),
          value: typeof value === 'string'
            ? value
            : <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 font-mono text-xs">{stringifyPlainValue(value)}</pre>,
        }))
      : []

    return [
      {
        id: 'payment',
        title: t('checkout.admin.transactionDetail.sections.payment'),
        icon: CircleDollarSign,
        rows: paymentRows,
      },
      {
        id: 'link',
        title: t('checkout.admin.transactionDetail.sections.link'),
        icon: Link2,
        rows: linkRows,
        footer: payload.link ? (
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link href={`/pay/${encodeURIComponent(payload.link.slug)}`}>
              <ExternalLink className="size-4" />
              {t('checkout.admin.transactionDetail.actions.viewPayLink')}
            </Link>
          </Button>
        ) : null,
      },
      {
        id: 'customer',
        title: t('checkout.admin.transactionDetail.sections.customer'),
        icon: UserRound,
        rows: customerRows,
      },
      {
        id: 'gateway',
        title: t('checkout.admin.transactionDetail.sections.gateway'),
        icon: WalletCards,
        rows: gatewayRows,
        footer: payload.transaction.gatewayTransactionId ? (
          <div className="flex flex-wrap gap-2">
            {canCapturePayment ? (
              <Button type="button" size="sm" className="rounded-xl" onClick={() => { void handleCapturePayment() }} disabled={isCapturing}>
                {isCapturing ? <Spinner className="size-4" /> : <HandCoins className="size-4" />}
                {t('checkout.admin.transactionDetail.actions.capturePayment', 'Capture payment')}
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link href={`/backend/payment-gateways?transactionId=${encodeURIComponent(payload.transaction.gatewayTransactionId)}`}>
                <WalletCards className="size-4" />
                {t('checkout.admin.transactionDetail.actions.viewGatewayTransaction', 'Open gateway transaction')}
              </Link>
            </Button>
          </div>
        ) : null,
      },
      {
        id: 'custom-fields',
        title: t('checkout.admin.transactionDetail.sections.customFields'),
        icon: ShieldCheck,
        rows: customFieldRows,
        emptyMessage: t('checkout.admin.transactionDetail.emptyCustomFields'),
      },
    ]
  }, [canCapturePayment, handleCapturePayment, isCapturing, payload, t, transactionId])

  const copyToClipboard = React.useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(successMessage, 'success')
    } catch {
      flash(t('checkout.admin.transactionDetail.copyError', 'Failed to copy transaction data.'), 'error')
    }
  }, [t])

  const copyAllSections = React.useCallback(async (format: 'markdown' | 'json') => {
    const text = format === 'markdown'
      ? sections.map((section) => buildSectionMarkdown(section)).join('\n\n')
      : JSON.stringify(
          sections.map((section) => ({
            section: section.id,
            title: section.title,
            fields: Object.fromEntries(section.rows.map((row) => [row.label, row.plainValue])),
          })),
          null,
          2,
        )
    await copyToClipboard(
      text,
      format === 'markdown'
        ? t('checkout.admin.transactionDetail.flash.copiedMarkdown', 'Transaction details copied as Markdown.')
        : t('checkout.admin.transactionDetail.flash.copiedJson', 'Transaction details copied as JSON.'),
    )
  }, [copyToClipboard, sections, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        <FormHeader
          mode="detail"
          backHref="/backend/checkout/transactions"
          entityTypeLabel={t('checkout.admin.transactionDetail.entityType', 'Checkout transaction')}
          title={t('checkout.admin.transactionDetail.title')}
          subtitle={t('checkout.admin.transactionDetail.description')}
          statusBadge={payload ? (
            <Badge variant="secondary">
              {t(`checkout.admin.transactions.status.${payload.transaction.status}`, payload.transaction.status)}
            </Badge>
          ) : undefined}
          actionsContent={payload ? (
          <>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => { void copyAllSections('markdown') }}>
              <Copy className="size-4" />
              {t('checkout.admin.transactionDetail.actions.copyMarkdown', 'Copy Markdown')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => { void copyAllSections('json') }}>
              <Braces className="size-4" />
              {t('checkout.admin.transactionDetail.actions.copyJson', 'Copy JSON')}
            </Button>
          </>
          ) : undefined}
        />
        {payload ? sections.map((section) => {
          const Icon = section.icon
          return (
            <Card key={section.id} className="overflow-hidden rounded-[24px] border-border/70 shadow-sm">
              <CardHeader className="border-b border-border/50 bg-muted/20">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-3 text-lg">
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-background shadow-sm">
                      <Icon className="size-5 text-muted-foreground" />
                    </span>
                    <span>{section.title}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <IconButton
                      aria-label={t('checkout.admin.transactionDetail.actions.copySectionMarkdown', 'Copy section as Markdown')}
                      title={t('checkout.admin.transactionDetail.actions.copySectionMarkdown', 'Copy section as Markdown')}
                      onClick={() => { void copyToClipboard(
                        buildSectionMarkdown(section),
                        t('checkout.admin.transactionDetail.flash.copiedSectionMarkdown', 'Section copied as Markdown.'),
                      ) }}
                    >
                      <Copy className="size-4" />
                    </IconButton>
                    <IconButton
                      aria-label={t('checkout.admin.transactionDetail.actions.copySectionJson', 'Copy section as JSON')}
                      title={t('checkout.admin.transactionDetail.actions.copySectionJson', 'Copy section as JSON')}
                      onClick={() => { void copyToClipboard(
                        buildSectionJson(section),
                        t('checkout.admin.transactionDetail.flash.copiedSectionJson', 'Section copied as JSON.'),
                      ) }}
                    >
                      <Braces className="size-4" />
                    </IconButton>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                {section.rows.length > 0 ? (
                  section.rows.map((row) => (
                    <DetailRow key={`${section.id}-${row.label}`} label={row.label} value={row.value} />
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">{section.emptyMessage ?? t('checkout.common.emptyValue')}</div>
                )}
                {section.footer ? <div className="pt-2">{section.footer}</div> : null}
              </CardContent>
            </Card>
          )
        }) : null}
      </PageBody>
    </Page>
  )
}
