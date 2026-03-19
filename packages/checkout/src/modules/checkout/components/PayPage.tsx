"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

export type PayLinkPayload = {
  id: string
  slug?: string | null
  name: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  logoUrl?: string | null
  backgroundColor?: string | null
  status?: 'draft' | 'active' | 'inactive'
  pricingMode: 'fixed' | 'custom_amount' | 'price_list'
  fixedPriceAmount?: number | null
  fixedPriceCurrencyCode?: string | null
  fixedPriceOriginalAmount?: number | null
  customAmountMin?: number | null
  customAmountMax?: number | null
  customAmountCurrencyCode?: string | null
  priceListItems?: Array<{ id: string; description: string; amount: number; currencyCode: string }>
  collectCustomerDetails?: boolean
  customerFieldsSchema?: Array<{ key: string; label: string; kind: string; required: boolean; placeholder?: string | null; options?: Array<{ value: string; label: string }> }>
  legalDocuments?: {
    terms?: { title?: string; markdown?: string; required?: boolean }
    privacyPolicy?: { title?: string; markdown?: string; required?: boolean }
  }
  requiresPassword?: boolean
  available?: boolean
  preview?: boolean
}

type PayPageProps = {
  mode?: 'link' | 'template'
  sourceId?: string
  initialPayload?: PayLinkPayload | null
  initialLoadError?: string | null
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function PayPage({ mode = 'link', sourceId, initialPayload = null, initialLoadError = null }: PayPageProps) {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const locale = useLocale()
  const routeSlug = typeof params?.slug === 'string' ? params.slug : ''
  const slug = sourceId ?? routeSlug
  const previewRequested = searchParams.get('preview') === 'true' || mode === 'template'
  const [payload, setPayload] = React.useState<PayLinkPayload | null>(initialPayload)
  const [isLoading, setIsLoading] = React.useState(initialPayload == null && initialLoadError == null)
  const [loadError, setLoadError] = React.useState<string | null>(initialLoadError)
  const [password, setPassword] = React.useState('')
  const [passwordError, setPasswordError] = React.useState<string | null>(null)
  const [isVerifyingPassword, setIsVerifyingPassword] = React.useState(false)
  const [customerData, setCustomerData] = React.useState<Record<string, unknown>>({})
  const [acceptedLegalConsents, setAcceptedLegalConsents] = React.useState<Record<string, boolean>>({})
  const [amount, setAmount] = React.useState<number | null>(null)
  const [selectedPriceItemId, setSelectedPriceItemId] = React.useState<string | null>(null)
  const [submissionError, setSubmissionError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const loadPayload = React.useCallback(async () => {
    if (!slug) return
    setIsLoading(true)
    setLoadError(null)
    const endpoint = mode === 'template'
      ? `/api/checkout/templates/${encodeURIComponent(slug)}/preview`
      : `/api/checkout/pay/${encodeURIComponent(slug)}${previewRequested ? '?preview=true' : ''}`
    try {
      const result = await readApiResultOrThrow<PayLinkPayload>(endpoint)
      setPayload(result)
      if (result.pricingMode === 'fixed' && typeof result.fixedPriceAmount === 'number') {
        setAmount(result.fixedPriceAmount)
      }
    } catch (error) {
      setPayload(null)
      setLoadError(readErrorMessage(error, t('checkout.payPage.errors.loadMessage', "We couldn't load this payment page. Please try again.")))
    } finally {
      setIsLoading(false)
    }
  }, [mode, previewRequested, slug, t])

  React.useEffect(() => {
    if (!slug) return
    if (initialPayload || initialLoadError) return
    void loadPayload()
  }, [initialLoadError, initialPayload, loadPayload, slug])

  const formatAmount = React.useCallback((value: number | null | undefined, currencyCode?: string | null) => {
    const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? value : 0
    if (currencyCode) {
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currencyCode,
        }).format(normalizedValue)
      } catch {
        // Fall through to decimal formatting if the currency code is invalid.
      }
    }
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(normalizedValue)
  }, [locale])

  if (!slug || isLoading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-3 px-4 py-16 text-sm text-muted-foreground">
        <Spinner size="sm" />
        <span>{t('checkout.payPage.loading', 'Loading payment link...')}</span>
      </div>
    )
  }
  if (loadError || !payload) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorNotice
          title={t('checkout.payPage.errors.loadTitle', 'Unable to load payment link')}
          message={loadError ?? t('checkout.payPage.errors.loadMessage', "We couldn't load this payment page. Please try again.")}
          action={(
            <Button type="button" variant="outline" onClick={() => { void loadPayload() }}>
              {t('checkout.payPage.actions.retry', 'Retry')}
            </Button>
          )}
        />
      </div>
    )
  }
  if (payload.requiresPassword) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card>
          <CardHeader><CardTitle>{payload.title ?? t('checkout.payPage.protectedTitle', 'Protected payment link')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('checkout.payPage.passwordPlaceholder', 'Password')}
            />
            {passwordError ? <p className="text-sm text-destructive">{passwordError}</p> : null}
            <Button
              type="button"
              disabled={isVerifyingPassword}
              onClick={async () => {
                setIsVerifyingPassword(true)
                setPasswordError(null)
                try {
                  await apiCallOrThrow(`/api/checkout/pay/${encodeURIComponent(slug)}/verify-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                  })
                  await loadPayload()
                } catch (error) {
                  setPasswordError(readErrorMessage(error, t('checkout.payPage.errors.password', 'Unable to verify password. Please try again.')))
                } finally {
                  setIsVerifyingPassword(false)
                }
              }}
            >
              <span className="flex items-center gap-2">
                {isVerifyingPassword ? <Spinner size="sm" /> : null}
                {isVerifyingPassword
                  ? t('checkout.payPage.actions.verifying', 'Verifying...')
                  : t('checkout.payPage.actions.continue', 'Continue')}
              </span>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }
  const isPreview = payload.preview === true || previewRequested
  if (payload.available === false && !isPreview) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">{t('checkout.payPage.unavailable', 'This payment link is no longer available.')}</div>
  }

  const selectedPriceItem = payload.priceListItems?.find((item) => item.id === selectedPriceItemId) ?? null
  const effectiveAmount = selectedPriceItem?.amount ?? amount
  const shouldCollectCustomerDetails = payload.collectCustomerDetails !== false && (payload.customerFieldsSchema?.length ?? 0) > 0
  const backHref = mode === 'template'
    ? `/backend/checkout/templates/${encodeURIComponent(payload.id)}`
    : `/backend/checkout/pay-links/${encodeURIComponent(payload.id)}`

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: payload.backgroundColor ?? '#f5f3ee' }}>
      {isPreview ? (
        <div className="mx-auto mb-4 max-w-6xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('checkout.payPage.previewBanner', 'Preview mode. Payments are disabled.')}</span>
            <Button asChild type="button" variant="outline">
              <Link href={backHref}>{t('checkout.payPage.actions.backToAdmin', 'Back to admin')}</Link>
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="space-y-6 p-8">
            {payload.logoUrl ? <img src={payload.logoUrl} alt={payload.title ?? payload.name} className="h-12 w-auto object-contain" /> : null}
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold">{payload.title ?? payload.name}</h1>
              {payload.subtitle ? <p className="text-muted-foreground">{payload.subtitle}</p> : null}
            </div>
            {payload.description ? (
              <div className="text-sm leading-6">
                <MarkdownContent body={payload.description} format="markdown" />
              </div>
            ) : null}
            {shouldCollectCustomerDetails ? (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">{t('checkout.payPage.sections.customerDetails', 'Customer details')}</h2>
                {(payload.customerFieldsSchema ?? []).map((field) => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}</label>
                    {field.kind === 'multiline' ? (
                      <Textarea
                        value={typeof customerData[field.key] === 'string' ? customerData[field.key] as string : ''}
                        onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.value }))}
                        placeholder={field.placeholder ?? undefined}
                      />
                    ) : field.kind === 'boolean' ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={customerData[field.key] === true} onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.checked }))} />
                        {field.label}
                      </label>
                    ) : field.kind === 'select' || field.kind === 'radio' ? (
                      <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={typeof customerData[field.key] === 'string' ? customerData[field.key] as string : ''} onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.value }))}>
                        <option value="">{t('checkout.payPage.fields.selectPlaceholder', 'Select...')}</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={typeof customerData[field.key] === 'string' ? customerData[field.key] as string : ''}
                        onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.value }))}
                        placeholder={field.placeholder ?? undefined}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-6 p-8">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{t('checkout.payPage.sections.payment', 'Payment')}</h2>
              {payload.pricingMode === 'fixed' ? (
                <div className="space-y-1">
                  {typeof payload.fixedPriceOriginalAmount === 'number' ? <div className="text-sm text-muted-foreground line-through">{formatAmount(payload.fixedPriceOriginalAmount, payload.fixedPriceCurrencyCode)}</div> : null}
                  <div className="text-3xl font-semibold">{formatAmount(payload.fixedPriceAmount, payload.fixedPriceCurrencyCode)}</div>
                </div>
              ) : null}
              {payload.pricingMode === 'custom_amount' ? (
                <Input type="number" value={effectiveAmount ?? ''} onChange={(event) => setAmount(Number(event.target.value))} placeholder={`${payload.customAmountMin ?? 0} - ${payload.customAmountMax ?? ''}`} />
              ) : null}
              {payload.pricingMode === 'price_list' ? (
                <div className="space-y-2">
                  {(payload.priceListItems ?? []).map((item) => (
                    <label key={item.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                      <span className="flex items-center gap-3">
                        <input type="radio" name="priceItem" checked={selectedPriceItemId === item.id} onChange={() => { setSelectedPriceItemId(item.id); setAmount(item.amount) }} />
                        <span>{item.description}</span>
                      </span>
                      <span className="font-medium">{formatAmount(item.amount, item.currencyCode)}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            {(payload.legalDocuments?.terms?.markdown || payload.legalDocuments?.privacyPolicy?.markdown) ? (
              <div className="space-y-3">
                {payload.legalDocuments?.terms?.markdown ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={acceptedLegalConsents.terms === true} onChange={(event) => setAcceptedLegalConsents((current) => ({ ...current, terms: event.target.checked }))} />
                    <span>{t('checkout.payPage.legal.acceptDocument', 'I accept {document}.', { document: payload.legalDocuments.terms.title || t('checkout.payPage.legal.defaultTermsTitle', 'the terms and conditions') })}</span>
                  </label>
                ) : null}
                {payload.legalDocuments?.privacyPolicy?.markdown ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={acceptedLegalConsents.privacyPolicy === true} onChange={(event) => setAcceptedLegalConsents((current) => ({ ...current, privacyPolicy: event.target.checked }))} />
                    <span>{t('checkout.payPage.legal.acceptDocument', 'I accept {document}.', { document: payload.legalDocuments.privacyPolicy.title || t('checkout.payPage.legal.defaultPrivacyTitle', 'the privacy policy') })}</span>
                  </label>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="text-sm text-muted-foreground">{t('checkout.payPage.summary.amountDue', 'Amount due')}</div>
              <div className="text-2xl font-semibold">{formatAmount(effectiveAmount, selectedPriceItem?.currencyCode ?? payload.fixedPriceCurrencyCode ?? payload.customAmountCurrencyCode ?? null)}</div>
            </div>
            {submissionError ? <p className="text-sm text-destructive">{submissionError}</p> : null}
            <Button
              type="button"
              className="w-full"
              disabled={isPreview || isSubmitting}
              onClick={async () => {
                if (isPreview) return
                setIsSubmitting(true)
                setSubmissionError(null)
                try {
                  const result = await readApiResultOrThrow<{ transactionId: string; redirectUrl?: string | null }>(
                    `/api/checkout/pay/${encodeURIComponent(slug)}/submit`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': crypto.randomUUID(),
                      },
                      body: JSON.stringify({
                        customerData,
                        acceptedLegalConsents,
                        amount: effectiveAmount,
                        selectedPriceItemId,
                      }),
                    },
                  )
                  if (result.redirectUrl) {
                    window.location.href = result.redirectUrl
                    return
                  }
                  router.push(`/pay/${encodeURIComponent(slug)}/success/${encodeURIComponent(result.transactionId)}`)
                } catch (error) {
                  setSubmissionError(readErrorMessage(error, t('checkout.payPage.errors.submit', 'Unable to start the payment. Please try again.')))
                } finally {
                  setIsSubmitting(false)
                }
              }}
            >
              <span className="flex items-center justify-center gap-2">
                {isSubmitting ? <Spinner size="sm" /> : null}
                {isPreview
                  ? t('checkout.payPage.actions.previewDisabled', 'Preview only')
                  : isSubmitting
                    ? t('checkout.payPage.actions.processingPayment', 'Processing payment...')
                    : t('checkout.payPage.actions.payNow', 'Pay now')}
              </span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default PayPage
