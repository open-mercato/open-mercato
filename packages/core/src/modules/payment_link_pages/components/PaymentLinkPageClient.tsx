"use client"

import * as React from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { buildPaymentGatewayPaymentLinkWidgetSpotId } from '@open-mercato/shared/modules/payment_gateways/types'
import {
  buildPaymentLinkPageInjectionSpotId,
  buildPaymentLinkPageSectionHandle,
  PAYMENT_LINK_PAGE_COMPONENT_HANDLE,
} from '@open-mercato/shared/modules/payment_link_pages/types'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { LanguageSwitcher } from '@open-mercato/ui/frontend/LanguageSwitcher'

export type PaymentLinkPageResponse = {
  passwordRequired: boolean
  accessGranted?: boolean
  _meta?: {
    enrichedBy?: string[]
    enricherErrors?: string[]
  }
  link?: {
    id?: string
    token: string
    title: string
    description?: string | null
    providerKey: string
    status: string
    completedAt?: string | null
    amount?: number
    currencyCode?: string
    paymentLinkWidgetSpotId?: string | null
    metadata?: Record<string, unknown> | null
    customFields?: Record<string, unknown> | null
    customFieldsetCode?: string | null
    customerCapture?: {
      enabled: boolean
      companyRequired: boolean
      termsRequired?: boolean
      termsMarkdown?: string | null
      collectedAt?: string | null
      termsAcceptedAt?: string | null
      companyEntityId?: string | null
      personEntityId?: string | null
      companyName?: string | null
      personName?: string | null
      email?: string | null
    } | null
  }
  transaction?: {
    id: string
    paymentId: string
    providerKey: string
    providerSessionId?: string | null
    unifiedStatus: string
    gatewayStatus?: string | null
    redirectUrl?: string | null
    clientSecret?: string | null
    amount: number
    currencyCode: string
    gatewayMetadata?: Record<string, unknown> | null
    createdAt?: string | null
    updatedAt?: string | null
  }
}

type SharedSectionProps = {
  data: PaymentLinkPageResponse | null
  loading: boolean
  error: string | null
  locale: string
}

type BrandSectionProps = SharedSectionProps

type SummarySectionProps = SharedSectionProps

type CheckoutSectionProps = SharedSectionProps & {
  password: string
  unlocking: boolean
  customerForm: {
    companyName: string
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  customerSubmitting: boolean
  customerError: string | null
  customerTermsAccepted: boolean
  onPasswordChange: (value: string) => void
  onUnlock: () => void
  onCustomerFieldChange: (field: 'companyName' | 'firstName' | 'lastName' | 'email' | 'phone', value: string) => void
  onCustomerTermsAcceptedChange: (accepted: boolean) => void
  onSubmitCustomer: () => void
  onRefreshLink: () => Promise<void>
}

type RootProps = {
  data: PaymentLinkPageResponse | null
  loading: boolean
  error: string | null
  customCss: string | null
  beforeContent: React.ReactNode
  heroContent: React.ReactNode
  summaryContent: React.ReactNode
  checkoutContent: React.ReactNode
  afterContent: React.ReactNode
}

function formatAmount(amount: number | undefined, currencyCode: string | undefined, locale: string): string {
  if (typeof amount !== 'number' || !currencyCode) return '-'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}

function statusTone(status: string | null | undefined): string {
  switch (status) {
    case 'captured':
    case 'authorized':
    case 'completed':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900'
    case 'failed':
    case 'cancelled':
      return 'border-rose-300 bg-rose-50 text-rose-900'
    default:
      return 'border-amber-300 bg-amber-50 text-amber-900'
  }
}

function formatMetadataLabel(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function renderMetadataValue(value: unknown): string {
  if (value == null) return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((entry) => renderMetadataValue(entry)).join(', ')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function DefaultBrandSection({ data }: BrandSectionProps) {
  const t = useT()
  const metadata = data?.link?.metadata ?? {}
  const logoUrl = typeof metadata.logoUrl === 'string' && metadata.logoUrl.trim().length > 0
    ? metadata.logoUrl.trim()
    : null
  const brandName = typeof metadata.brandName === 'string' && metadata.brandName.trim().length > 0
    ? metadata.brandName.trim()
    : 'Open Mercato'
  const securitySubtitle = typeof metadata.securitySubtitle === 'string' && metadata.securitySubtitle.trim().length > 0
    ? metadata.securitySubtitle.trim()
    : t('payment_gateways.paymentLink.securityTitle', 'Protected checkout')

  return (
    <div
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      data-component-handle={buildPaymentLinkPageSectionHandle('brand')}
    >
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName}
            className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain p-1.5 shadow-sm"
          />
        ) : (
          <Image
            src="/open-mercato.svg"
            alt={brandName}
            width={40}
            height={40}
            priority
            className="h-10 w-10 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
          />
        )}
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">{brandName}</div>
          <div className="text-sm text-slate-600">{securitySubtitle}</div>
        </div>
      </div>
      <div className="self-start rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 shadow-sm">
        <LanguageSwitcher />
      </div>
    </div>
  )
}

function DefaultSummarySection({ data, locale }: SummarySectionProps) {
  const t = useT()
  const summaryAmount = formatAmount(
    data?.link?.amount ?? data?.transaction?.amount,
    data?.link?.currencyCode ?? data?.transaction?.currencyCode,
    locale,
  )
  const customFields = data?.link?.customFields ?? {}

  return (
    <section
      className="rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-[0_30px_90px_-45px_rgba(15,23,42,0.45)] backdrop-blur"
      data-component-handle={buildPaymentLinkPageSectionHandle('summary')}
    >
      <div className="space-y-5">
        <div className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-1 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
          {t('payment_gateways.paymentLink.eyebrow', 'Secure payment link')}
        </div>
        <div className="space-y-3">
          <h1 className="font-serif text-4xl leading-tight text-slate-950">
            {data?.link?.title ?? t('payment_gateways.paymentLink.titleDefault', 'Complete your payment')}
          </h1>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            {data?.link?.description ?? t('payment_gateways.paymentLink.descriptionDefault', 'Use the secure checkout on this page to finish the transaction.')}
          </p>
        </div>
        <div className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${statusTone(data?.link?.status ?? data?.transaction?.unifiedStatus ?? null)}`}>
          {data?.link?.status === 'completed'
            ? t('payment_gateways.paymentLink.status.completed', 'Paid')
            : data?.transaction?.unifiedStatus
              ? t(`payment_gateways.status.${data.transaction.unifiedStatus}`, data.transaction.unifiedStatus)
              : t('payment_gateways.paymentLink.status.pending', 'Pending')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {t('payment_gateways.paymentLink.summary.amount', 'Amount')}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{summaryAmount}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {t('payment_gateways.paymentLink.summary.provider', 'Provider')}
            </div>
            <div className="mt-2 text-2xl font-semibold capitalize text-slate-950">
              {data?.link?.providerKey ?? data?.transaction?.providerKey ?? '-'}
            </div>
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('payment_gateways.paymentLink.securityTitle', 'Protected checkout')}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {t('payment_gateways.paymentLink.securityBody', 'Payment details stay inside the gateway checkout flow. This page only loads the provider UI that belongs to the selected gateway.')}
          </p>
        </div>
        {Object.keys(customFields).length > 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('payment_gateways.paymentLink.metadata.title', 'Additional information')}
            </h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(customFields).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">{formatMetadataLabel(key)}</dt>
                  <dd className="mt-2 text-sm text-slate-700">{renderMetadataValue(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function DefaultCheckoutSection({
  data,
  loading,
  error,
  password,
  unlocking,
  customerForm,
  customerSubmitting,
  customerError,
  customerTermsAccepted,
  onPasswordChange,
  onUnlock,
  onCustomerFieldChange,
  onCustomerTermsAcceptedChange,
  onSubmitCustomer,
  onRefreshLink,
}: CheckoutSectionProps) {
  const t = useT()
  const customerCapture = data?.link?.customerCapture
  const providerWidgetSpotId =
    data?.link?.paymentLinkWidgetSpotId ||
    (data?.transaction?.providerKey ? buildPaymentGatewayPaymentLinkWidgetSpotId(data.transaction.providerKey) : null)
  const redirectUrl = typeof data?.transaction?.redirectUrl === 'string' && data.transaction.redirectUrl.trim().length > 0
    ? data.transaction.redirectUrl
    : null
  const isSettled = data?.link?.status === 'completed'
    || ['authorized', 'captured', 'partially_captured', 'refunded', 'partially_refunded'].includes(data?.transaction?.unifiedStatus ?? '')
  const customerCaptureRequired = customerCapture?.enabled === true && !customerCapture.collectedAt
  const termsRequired = customerCapture?.termsRequired === true && !!customerCapture?.termsMarkdown
  const canFillCustomerForm = !termsRequired || customerTermsAccepted
  const customerFormReady = customerForm.firstName.trim().length > 0
    && customerForm.lastName.trim().length > 0
    && customerForm.email.trim().length > 0
    && (!customerCapture?.companyRequired || customerForm.companyName.trim().length > 0)
    && (!termsRequired || customerTermsAccepted)

  return (
    <section
      className="rounded-[32px] border border-slate-200/80 bg-[#101828] p-6 text-slate-50 shadow-[0_30px_90px_-45px_rgba(15,23,42,0.55)] sm:p-8"
      data-component-handle={buildPaymentLinkPageSectionHandle('checkout')}
    >
      {loading ? (
        <div className="flex min-h-[420px] items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : data?.passwordRequired ? (
        <div className="mx-auto flex min-h-[420px] max-w-md flex-col justify-center space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t('payment_gateways.paymentLink.passwordTitle', 'Protected access')}
            </div>
            <h2 className="text-3xl font-semibold text-white">
              {t('payment_gateways.paymentLink.passwordHeading', 'Enter password')}
            </h2>
            <p className="text-sm leading-6 text-slate-300">
              {t('payment_gateways.paymentLink.passwordBody', 'This payment link is password protected.')}
            </p>
          </div>
          <div className="space-y-3">
            <Input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={t('payment_gateways.paymentLink.passwordPlaceholder', 'Password')}
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Button type="button" disabled={unlocking || password.trim().length === 0} onClick={onUnlock}>
              {unlocking ? t('payment_gateways.paymentLink.unlocking', 'Unlocking...') : t('payment_gateways.paymentLink.unlock', 'Unlock')}
            </Button>
          </div>
        </div>
      ) : error ? (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="max-w-lg rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
            <div className="text-lg font-semibold text-white">
              {error ?? t('payment_gateways.paymentLink.unavailable', 'This payment link is unavailable.')}
            </div>
          </div>
        </div>
      ) : isSettled ? (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="max-w-lg rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-6 text-center">
            <div className="text-lg font-semibold text-white">
              {t('payment_gateways.paymentLink.paidMessage', 'This payment link has already been completed.')}
            </div>
          </div>
        </div>
      ) : customerCaptureRequired ? (
        <div className="mx-auto flex min-h-[420px] max-w-xl flex-col justify-center space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t('payment_gateways.paymentLink.customerCapture.eyebrow', 'Customer details')}
            </div>
            <h2 className="text-3xl font-semibold text-white">
              {t('payment_gateways.paymentLink.customerCapture.title', 'Continue to secure checkout')}
            </h2>
            <p className="text-sm leading-6 text-slate-300">
              {t(
                'payment_gateways.paymentLink.customerCapture.body',
                'Enter your customer details first. The merchant will use them to match or create your customer record before payment.',
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {termsRequired ? (
              <div className="space-y-3 sm:col-span-2">
                <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-200">
                    {t('payment_gateways.paymentLink.customerCapture.termsTitle', 'Terms / GDPR consent')}
                  </div>
                  <MarkdownContent
                    body={customerCapture?.termsMarkdown ?? ''}
                    format="markdown"
                    className="prose prose-invert max-w-none text-sm"
                  />
                </div>
                <label className="flex items-start gap-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-200">
                  <Checkbox
                    checked={customerTermsAccepted}
                    onCheckedChange={(checked) => onCustomerTermsAcceptedChange(checked === true)}
                  />
                  <span>
                    {t(
                      'payment_gateways.paymentLink.customerCapture.acceptTerms',
                      'I have read and accept the terms / GDPR notice above.',
                    )}
                  </span>
                </label>
              </div>
            ) : null}
            {customerCapture?.companyRequired ? (
              <div className="space-y-2 sm:col-span-2">
                <div className="text-sm font-medium text-slate-200">
                  {t('payment_gateways.paymentLink.customerCapture.companyName', 'Company name')}
                </div>
                <Input
                  value={customerForm.companyName}
                  onChange={(event) => onCustomerFieldChange('companyName', event.target.value)}
                  className="border-slate-700 bg-slate-950 text-white"
                  disabled={!canFillCustomerForm}
                />
              </div>
            ) : null}
            {!customerCapture?.companyRequired ? (
              <div className="space-y-2 sm:col-span-2">
                <div className="text-sm font-medium text-slate-200">
                  {t('payment_gateways.paymentLink.customerCapture.companyOptional', 'Company name (optional)')}
                </div>
                <Input
                  value={customerForm.companyName}
                  onChange={(event) => onCustomerFieldChange('companyName', event.target.value)}
                  className="border-slate-700 bg-slate-950 text-white"
                  disabled={!canFillCustomerForm}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-200">
                {t('payment_gateways.paymentLink.customerCapture.firstName', 'First name')}
              </div>
              <Input
                value={customerForm.firstName}
                onChange={(event) => onCustomerFieldChange('firstName', event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
                disabled={!canFillCustomerForm}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-200">
                {t('payment_gateways.paymentLink.customerCapture.lastName', 'Last name')}
              </div>
              <Input
                value={customerForm.lastName}
                onChange={(event) => onCustomerFieldChange('lastName', event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
                disabled={!canFillCustomerForm}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-200">
                {t('payment_gateways.paymentLink.customerCapture.email', 'Email')}
              </div>
              <Input
                type="email"
                value={customerForm.email}
                onChange={(event) => onCustomerFieldChange('email', event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
                disabled={!canFillCustomerForm}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-200">
                {t('payment_gateways.paymentLink.customerCapture.phone', 'Phone (optional)')}
              </div>
              <Input
                value={customerForm.phone}
                onChange={(event) => onCustomerFieldChange('phone', event.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
                disabled={!canFillCustomerForm}
              />
            </div>
          </div>

          {customerError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
              {customerError}
            </div>
          ) : null}

          <div>
            <Button type="button" disabled={customerSubmitting || !customerFormReady} onClick={onSubmitCustomer}>
              {customerSubmitting
                ? t('payment_gateways.paymentLink.customerCapture.submitting', 'Saving details...')
                : t('payment_gateways.paymentLink.customerCapture.submit', 'Continue to payment')}
            </Button>
          </div>
        </div>
      ) : providerWidgetSpotId ? (
        <div className="min-h-[420px]">
          <InjectionSpot
            spotId={providerWidgetSpotId}
            context={{
              link: data?.link ?? null,
              paymentLink: data?.link ?? null,
              transaction: data?.transaction ?? null,
              metadata: data?.link?.metadata ?? null,
              customFields: data?.link?.customFields ?? null,
              customerCapture: data?.link?.customerCapture ?? null,
              refreshLink: onRefreshLink,
            }}
            data={{
              link: data?.link ?? null,
              paymentLink: data?.link ?? null,
              transaction: data?.transaction ?? null,
              redirectUrl,
              customerCapture: data?.link?.customerCapture ?? null,
            }}
          />
        </div>
      ) : (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="max-w-lg rounded-3xl border border-amber-400/20 bg-amber-500/10 p-6 text-center">
            <div className="text-lg font-semibold text-white">
              {t('payment_gateways.paymentLink.noCheckout', 'No checkout component is configured for this provider.')}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function DefaultPaymentLinkPageRoot({
  customCss,
  beforeContent,
  heroContent,
  summaryContent,
  checkoutContent,
  afterContent,
}: RootProps) {
  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.14),_transparent_38%),linear-gradient(180deg,_#f5f7f1_0%,_#eef4ff_48%,_#f8fafc_100%)] px-4 py-10 text-slate-950 sm:px-6"
      data-component-handle={PAYMENT_LINK_PAGE_COMPONENT_HANDLE}
    >
      {customCss ? <style>{customCss}</style> : null}
      {beforeContent}
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-6">
          {heroContent}
          {summaryContent}
        </div>
        <div className="space-y-6">{checkoutContent}</div>
      </div>
      {afterContent}
    </main>
  )
}

export function PaymentLinkPageClient({ token }: { token: string }) {
  const t = useT()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const accessStorageKey = React.useMemo(() => `payment-link:${token}:access`, [token])
  const [accessToken, setAccessToken] = React.useState<string | null>(null)
  const [data, setData] = React.useState<PaymentLinkPageResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [unlocking, setUnlocking] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [customerSubmitting, setCustomerSubmitting] = React.useState(false)
  const [customerError, setCustomerError] = React.useState<string | null>(null)
  const [customerTermsAccepted, setCustomerTermsAccepted] = React.useState(false)
  const [customerForm, setCustomerForm] = React.useState({
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })

  const loadLink = React.useCallback(async () => {
    if (!token) return
    setLoading(true)
    const call = await apiCall<PaymentLinkPageResponse>(`/api/payment_link_pages/pay/${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: {
        ...(accessToken ? { 'x-payment-link-access': accessToken } : {}),
        'x-om-handle-forbidden': 'true',
      },
    }, { fallback: null })
    if (call.ok && call.result) {
      setData(call.result)
      setError(null)
      setCustomerError(null)
      setLoading(false)
      return
    }
    if (call.response?.status === 403 && call.result) {
      setData(call.result)
      setError(null)
      setLoading(false)
      return
    }
    setData(null)
    setError(t('payment_gateways.paymentLink.loadError', 'Unable to load this payment link.'))
    setLoading(false)
  }, [accessToken, t, token])

  React.useEffect(() => {
    const customerCapture = data?.link?.customerCapture
    if (customerCapture?.collectedAt) return
    setCustomerTermsAccepted(customerCapture?.termsAcceptedAt != null)
    setCustomerForm((current) => ({
      companyName: current.companyName || customerCapture?.companyName || '',
      firstName: current.firstName,
      lastName: current.lastName,
      email: current.email || customerCapture?.email || '',
      phone: current.phone,
    }))
  }, [data?.link?.customerCapture])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.sessionStorage.getItem(accessStorageKey)
    if (stored) setAccessToken(stored)
  }, [accessStorageKey])

  React.useEffect(() => {
    void loadLink()
  }, [loadLink])

  const handleUnlock = React.useCallback(async () => {
    if (!token || !password.trim()) return
    setUnlocking(true)
    setError(null)
    const call = await apiCall<{ accessToken?: string | null }>(
      `/api/payment_link_pages/pay/${encodeURIComponent(token)}/unlock`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-om-handle-forbidden': 'true',
        },
        body: JSON.stringify({ password: password.trim() }),
      },
      { fallback: null },
    )
    if (call.ok && call.result?.accessToken) {
      setAccessToken(call.result.accessToken)
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(accessStorageKey, call.result.accessToken)
      }
      setPassword('')
      setUnlocking(false)
      await loadLink()
      return
    }
    setUnlocking(false)
    setError(t('payment_gateways.paymentLink.passwordError', 'The password is incorrect.'))
  }, [accessStorageKey, loadLink, password, t, token])

  const handleCustomerFieldChange = React.useCallback(
    (field: 'companyName' | 'firstName' | 'lastName' | 'email' | 'phone', value: string) => {
      setCustomerForm((current) => ({ ...current, [field]: value }))
    },
    [],
  )

  const handleCustomerSubmit = React.useCallback(async () => {
    if (!token) return
    setCustomerSubmitting(true)
    setCustomerError(null)
    const call = await apiCall<{ error?: string }>(
      `/api/payment_link_pages/pay/${encodeURIComponent(token)}/customer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-om-handle-forbidden': 'true',
          ...(accessToken ? { 'x-payment-link-access': accessToken } : {}),
        },
        body: JSON.stringify({
          ...customerForm,
          acceptedTerms: customerTermsAccepted,
        }),
      },
      { fallback: null },
    )

    if (call.ok) {
      setCustomerSubmitting(false)
      await loadLink()
      return
    }

    setCustomerSubmitting(false)
    setCustomerError(call.result?.error ?? t('payment_gateways.paymentLink.customerCapture.error', 'Unable to save your details.'))
  }, [accessToken, customerForm, customerTermsAccepted, loadLink, t, token])

  const redirectUrl = typeof data?.transaction?.redirectUrl === 'string' && data.transaction.redirectUrl.trim().length > 0
    ? data.transaction.redirectUrl
    : null
  const checkoutReturnState = searchParams.get('checkout')
  const isSettled = data?.link?.status === 'completed'
    || ['authorized', 'captured', 'partially_captured', 'refunded', 'partially_refunded'].includes(data?.transaction?.unifiedStatus ?? '')
  const shouldAutoRedirect = Boolean(
    redirectUrl
    && !loading
    && !error
    && !data?.passwordRequired
    && !(data?.link?.customerCapture?.enabled && !data.link.customerCapture.collectedAt)
    && !isSettled
    && !checkoutReturnState,
  )
  const hasAutoRedirectedRef = React.useRef(false)

  React.useEffect(() => {
    if (!shouldAutoRedirect || !redirectUrl || typeof window === 'undefined' || hasAutoRedirectedRef.current) {
      return
    }
    hasAutoRedirectedRef.current = true
    window.location.replace(redirectUrl)
  }, [redirectUrl, shouldAutoRedirect])

  const RootComponent = useRegisteredComponent<RootProps>(
    PAYMENT_LINK_PAGE_COMPONENT_HANDLE,
    DefaultPaymentLinkPageRoot,
  )
  const BrandComponent = useRegisteredComponent<BrandSectionProps>(
    buildPaymentLinkPageSectionHandle('brand'),
    DefaultBrandSection,
  )
  const SummaryComponent = useRegisteredComponent<SummarySectionProps>(
    buildPaymentLinkPageSectionHandle('summary'),
    DefaultSummarySection,
  )
  const CheckoutComponent = useRegisteredComponent<CheckoutSectionProps>(
    buildPaymentLinkPageSectionHandle('checkout'),
    DefaultCheckoutSection,
  )

  const injectionContext = React.useMemo(() => ({
    token,
    paymentLink: data?.link ?? null,
    transaction: data?.transaction ?? null,
    metadata: data?.link?.metadata ?? null,
    customFields: data?.link?.customFields ?? null,
    customerCapture: data?.link?.customerCapture ?? null,
    enrichedBy: data?._meta?.enrichedBy ?? [],
  }), [data, token])

  const customCss = data?.link?.metadata && typeof data.link.metadata.customCss === 'string'
    ? data.link.metadata.customCss
    : null

  return (
    <RootComponent
      data={data}
      loading={loading}
      error={error}
      customCss={customCss}
      beforeContent={
        <InjectionSpot
          spotId={buildPaymentLinkPageInjectionSpotId('before')}
          context={injectionContext}
          data={data ?? undefined}
        />
      }
      heroContent={
        <>
          <BrandComponent data={data} loading={loading} error={error} locale={locale} />
          <InjectionSpot
            spotId={buildPaymentLinkPageInjectionSpotId('hero')}
            context={injectionContext}
            data={data ?? undefined}
          />
        </>
      }
      summaryContent={
        <>
          <SummaryComponent data={data} loading={loading} error={error} locale={locale} />
          <InjectionSpot
            spotId={buildPaymentLinkPageInjectionSpotId('summary')}
            context={injectionContext}
            data={data ?? undefined}
          />
        </>
      }
      checkoutContent={
        <>
          <CheckoutComponent
            data={data}
            loading={loading}
            error={error}
            locale={locale}
            password={password}
            unlocking={unlocking}
            customerForm={customerForm}
            customerSubmitting={customerSubmitting}
            customerError={customerError}
            customerTermsAccepted={customerTermsAccepted}
            onPasswordChange={setPassword}
            onUnlock={() => {
              void handleUnlock()
            }}
            onCustomerFieldChange={handleCustomerFieldChange}
            onCustomerTermsAcceptedChange={setCustomerTermsAccepted}
            onSubmitCustomer={() => {
              void handleCustomerSubmit()
            }}
            onRefreshLink={loadLink}
          />
          <InjectionSpot
            spotId={buildPaymentLinkPageInjectionSpotId('checkout')}
            context={injectionContext}
            data={data ?? undefined}
          />
        </>
      }
      afterContent={
        <InjectionSpot
          spotId={buildPaymentLinkPageInjectionSpotId('after')}
          context={injectionContext}
          data={data ?? undefined}
        />
      }
    />
  )
}

export default PaymentLinkPageClient
