"use client"

import * as React from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildPaymentGatewayPaymentLinkWidgetSpotId } from '@open-mercato/shared/modules/payment_gateways/types'

type PaymentLinkResponse = {
  passwordRequired: boolean
  accessGranted?: boolean
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

function formatAmount(amount: number | undefined, currencyCode: string | undefined): string {
  if (typeof amount !== 'number' || !currencyCode) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
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

export default function PaymentLinkPage({ params }: { params: { token: string } }) {
  const t = useT()
  const searchParams = useSearchParams()
  const token = params?.token
  const accessStorageKey = React.useMemo(() => `payment-link:${token}:access`, [token])
  const [accessToken, setAccessToken] = React.useState<string | null>(null)
  const [data, setData] = React.useState<PaymentLinkResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [unlocking, setUnlocking] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const loadLink = React.useCallback(async () => {
    if (!token) return
    setLoading(true)
    const call = await apiCall<PaymentLinkResponse>(`/api/payment_gateways/pay/${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: {
        ...(accessToken ? { 'x-payment-link-access': accessToken } : {}),
        'x-om-handle-forbidden': 'true',
      },
    }, { fallback: null })
    if (call.ok && call.result) {
      setData(call.result)
      setError(null)
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
    if (typeof window === 'undefined') return
    const stored = window.sessionStorage.getItem(accessStorageKey)
    if (stored) {
      setAccessToken(stored)
    }
  }, [accessStorageKey])

  React.useEffect(() => {
    void loadLink()
  }, [loadLink])

  const handleUnlock = React.useCallback(async () => {
    if (!token || !password.trim()) return
    setUnlocking(true)
    setError(null)
    const call = await apiCall<{ accessToken?: string | null }>(
      `/api/payment_gateways/pay/${encodeURIComponent(token)}/unlock`,
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

  const providerWidgetSpotId =
    data?.link?.paymentLinkWidgetSpotId ||
    (data?.transaction?.providerKey ? buildPaymentGatewayPaymentLinkWidgetSpotId(data.transaction.providerKey) : null)

  const summaryAmount = formatAmount(
    data?.link?.amount ?? data?.transaction?.amount,
    data?.link?.currencyCode ?? data?.transaction?.currencyCode,
  )
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.14),_transparent_38%),linear-gradient(180deg,_#f5f7f1_0%,_#eef4ff_48%,_#f8fafc_100%)] px-4 py-10 text-slate-950 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-[0_30px_90px_-45px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Image src="/open-mercato.svg" alt="Open Mercato" width={40} height={40} priority className="h-10 w-10 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm" />
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Open Mercato
                </div>
                <div className="text-sm text-slate-600">
                  {t('payment_gateways.paymentLink.securityTitle', 'Protected checkout')}
                </div>
              </div>
            </div>
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
                  {data?.link?.providerKey ?? data?.transaction?.providerKey ?? '—'}
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
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200/80 bg-[#101828] p-6 text-slate-50 shadow-[0_30px_90px_-45px_rgba(15,23,42,0.55)] sm:p-8">
          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          ) : data?.passwordRequired ? (
            <div className="mx-auto flex min-h-[420px] max-w-md flex-col justify-center space-y-5">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">{t('payment_gateways.paymentLink.passwordTitle', 'Enter password')}</h2>
                <p className="text-sm text-slate-300">
                  {t('payment_gateways.paymentLink.passwordBody', 'This payment link is password protected.')}
                </p>
              </div>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('payment_gateways.paymentLink.passwordPlaceholder', 'Password')}
                className="border-slate-700 bg-slate-950 text-slate-50"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && password.trim() && !unlocking) {
                    event.preventDefault()
                    void handleUnlock()
                  }
                }}
              />
              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
              <Button type="button" onClick={() => void handleUnlock()} disabled={unlocking || !password.trim()}>
                {unlocking ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t('payment_gateways.paymentLink.unlock', 'Unlock payment')}
              </Button>
            </div>
          ) : error || !data?.transaction ? (
            <div className="flex min-h-[420px] items-center justify-center text-center text-sm text-rose-200">
              {error ?? t('payment_gateways.paymentLink.unavailable', 'This payment link is unavailable.')}
            </div>
          ) : redirectUrl ? (
            <div className="mx-auto flex min-h-[420px] max-w-md flex-col justify-center space-y-5">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">
                  {isSettled
                    ? t('payment_gateways.paymentLink.status.completed', 'Paid')
                    : t('payment_gateways.paymentLink.redirectTitle', 'Continue to payment')}
                </h2>
                <p className="text-sm text-slate-300">
                  {isSettled
                    ? t('payment_gateways.paymentLink.paidMessage', 'This payment link has already been completed.')
                    : t('payment_gateways.paymentLink.redirectBody', 'This provider completes the payment on its own hosted checkout page.')}
                </p>
              </div>
              {isSettled ? null : (
                <Button type="button" asChild>
                  <a href={redirectUrl}>
                    {t('payment_gateways.paymentLink.redirectButton', 'Open secure checkout')}
                  </a>
                </Button>
              )}
            </div>
          ) : providerWidgetSpotId ? (
            <div className="space-y-5">
              <InjectionSpot
                spotId={providerWidgetSpotId}
                context={{ refreshLink: loadLink }}
                data={data}
              />
              {!data.link || (data.link.status !== 'completed' && !['authorized', 'captured', 'partially_captured'].includes(data.transaction.unifiedStatus)) ? null : (
                <div className="rounded-3xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
                  {t('payment_gateways.paymentLink.paidMessage', 'This payment link has already been completed.')}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center text-center text-sm text-slate-300">
              {t('payment_gateways.paymentLink.noRenderer', 'This payment provider does not expose a public checkout widget yet.')}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
