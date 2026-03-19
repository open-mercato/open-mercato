"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { PaymentGatewayClientSession } from '@open-mercato/shared/modules/payment_gateways/types'
import { getEmbeddedPaymentGatewayRenderer } from '@open-mercato/shared/modules/payment_gateways/client'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import type { CustomFieldDisplayEntry } from '@open-mercato/shared/lib/crud/custom-fields'

type CustomerFieldOption = {
  value: string
  label: string
}

type CustomerFieldDefinition = {
  key: string
  label: string
  kind: string
  required: boolean
  placeholder?: string | null
  options?: CustomerFieldOption[]
}

type PriceListItem = {
  id: string
  description: string
  amount: number
  currencyCode: string
}

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
  priceListItems?: PriceListItem[]
  collectCustomerDetails?: boolean
  customerFieldsSchema?: CustomerFieldDefinition[]
  publicCustomFields?: CustomFieldDisplayEntry[]
  legalDocuments?: {
    terms?: { title?: string; markdown?: string; required?: boolean }
    privacyPolicy?: { title?: string; markdown?: string; required?: boolean }
  }
  requiresPassword?: boolean
  available?: boolean
  preview?: boolean
  gatewayProviderKey?: string | null
}

type SubmitResponse = {
  transactionId: string
  redirectUrl?: string | null
  paymentSession?: (PaymentGatewayClientSession & {
    providerKey: string | null
    gatewayTransactionId: string
  }) | null
}

type PayPageProps = {
  mode?: 'link' | 'template'
  sourceId?: string
  initialPayload?: PayLinkPayload | null
  initialLoadError?: string | null
}

type FieldErrors = Record<string, string>

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function parseNumericInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function formatPublicFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return ''
  return String(value)
}

export function PayPage({
  mode = 'link',
  sourceId,
  initialPayload = null,
  initialLoadError = null,
}: PayPageProps) {
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
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [paymentSession, setPaymentSession] = React.useState<SubmitResponse['paymentSession']>(null)
  const [activeTransactionId, setActiveTransactionId] = React.useState<string | null>(null)
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
      setPaymentSession(null)
      setActiveTransactionId(null)
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

  React.useEffect(() => {
    if (!payload) return
    if (payload.pricingMode === 'fixed' && typeof payload.fixedPriceAmount === 'number') {
      setAmount(payload.fixedPriceAmount)
      return
    }
    if (payload.pricingMode !== 'price_list') {
      setSelectedPriceItemId(null)
    }
  }, [payload])

  const formatAmount = React.useCallback((value: number | null | undefined, currencyCode?: string | null) => {
    const normalizedValue = typeof value === 'number' && Number.isFinite(value) ? value : 0
    if (currencyCode) {
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currencyCode,
        }).format(normalizedValue)
      } catch {
        return `${normalizedValue.toFixed(2)} ${currencyCode}`
      }
    }
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(normalizedValue)
  }, [locale])

  const isPreview = payload?.preview === true || previewRequested
  const selectedPriceItem = payload?.priceListItems?.find((item) => item.id === selectedPriceItemId) ?? null
  const shouldCollectCustomerDetails = payload != null
    && payload.collectCustomerDetails !== false
    && (payload.customerFieldsSchema?.length ?? 0) > 0
  const effectiveAmount = selectedPriceItem?.amount ?? amount
  const effectiveCurrencyCode = selectedPriceItem?.currencyCode
    ?? payload?.fixedPriceCurrencyCode
    ?? payload?.customAmountCurrencyCode
    ?? null
  const inputsLocked = isSubmitting || paymentSession != null
  const publicCustomFields = payload?.publicCustomFields ?? []

  const resolveFieldLabel = React.useCallback((fieldPath: string): string => {
    if (!payload) return t('checkout.payPage.validation.thisField', 'this field')
    if (fieldPath.startsWith('customerData.')) {
      const fieldKey = fieldPath.slice('customerData.'.length)
      return payload.customerFieldsSchema?.find((field) => field.key === fieldKey)?.label
        ?? fieldKey
    }
    if (fieldPath === 'amount') {
      return t('checkout.payPage.summary.amountDue', 'Amount due')
    }
    if (fieldPath === 'selectedPriceItemId') {
      return t('checkout.payPage.validation.labels.option', 'payment option')
    }
    if (fieldPath.startsWith('acceptedLegalConsents.')) {
      const consentKey = fieldPath.slice('acceptedLegalConsents.'.length)
      if (consentKey === 'terms') {
        return payload.legalDocuments?.terms?.title
          ?? t('checkout.payPage.legal.defaultTermsTitle', 'the terms and conditions')
      }
      if (consentKey === 'privacyPolicy') {
        return payload.legalDocuments?.privacyPolicy?.title
          ?? t('checkout.payPage.legal.defaultPrivacyTitle', 'the privacy policy')
      }
    }
    return t('checkout.payPage.validation.thisField', 'this field')
  }, [payload, t])

  const translateValidationMessage = React.useCallback((message: string | null | undefined, fieldPath?: string) => {
    const trimmed = typeof message === 'string' ? message.trim() : ''
    if (!trimmed) return ''
    if (trimmed === 'checkout.payPage.validation.requiredField') {
      return t(trimmed, 'Enter {field}.', { field: resolveFieldLabel(fieldPath ?? '') })
    }
    if (trimmed === 'checkout.payPage.validation.documentRequired') {
      return t(trimmed, 'Accept {field} to continue.', { field: resolveFieldLabel(fieldPath ?? '') })
    }
    return t(trimmed, trimmed)
  }, [resolveFieldLabel, t])

  const clearFieldError = React.useCallback((fieldPath: string) => {
    setFieldErrors((current) => {
      if (!current[fieldPath]) return current
      const next = { ...current }
      delete next[fieldPath]
      return next
    })
  }, [])

  const updateCustomerField = React.useCallback((fieldKey: string, value: unknown) => {
    setCustomerData((current) => ({ ...current, [fieldKey]: value }))
    clearFieldError(`customerData.${fieldKey}`)
    setSubmissionError(null)
  }, [clearFieldError])

  const updateConsent = React.useCallback((fieldKey: 'terms' | 'privacyPolicy', value: boolean) => {
    setAcceptedLegalConsents((current) => ({ ...current, [fieldKey]: value }))
    clearFieldError(`acceptedLegalConsents.${fieldKey}`)
    setSubmissionError(null)
  }, [clearFieldError])

  const validateBeforeSubmit = React.useCallback((): FieldErrors => {
    if (!payload) return {}
    const nextErrors: FieldErrors = {}

    if (shouldCollectCustomerDetails) {
      for (const field of payload.customerFieldsSchema ?? []) {
        if (field.required !== true) continue
        const value = customerData[field.key]
        const isMissing = field.kind === 'boolean'
          ? value !== true
          : value == null || `${value}`.trim().length === 0
        if (isMissing) {
          nextErrors[`customerData.${field.key}`] = 'checkout.payPage.validation.requiredField'
        }
      }
    }

    if (payload.pricingMode === 'custom_amount') {
      if (effectiveAmount == null || !Number.isFinite(effectiveAmount)) {
        nextErrors.amount = 'checkout.payPage.validation.amountRequired'
      } else {
        if (payload.customAmountMin != null && effectiveAmount < payload.customAmountMin) {
          nextErrors.amount = t(
            'checkout.payPage.validation.amountMin',
            'Enter at least {amount}.',
            { amount: formatAmount(payload.customAmountMin, payload.customAmountCurrencyCode) },
          )
        }
        if (payload.customAmountMax != null && effectiveAmount > payload.customAmountMax) {
          nextErrors.amount = t(
            'checkout.payPage.validation.amountMax',
            'Enter no more than {amount}.',
            { amount: formatAmount(payload.customAmountMax, payload.customAmountCurrencyCode) },
          )
        }
      }
    }

    if (payload.pricingMode === 'price_list' && !selectedPriceItemId) {
      nextErrors.selectedPriceItemId = 'checkout.payPage.validation.priceSelectionRequired'
    }

    for (const key of ['terms', 'privacyPolicy'] as const) {
      const document = payload.legalDocuments?.[key]
      if (document?.required === true && acceptedLegalConsents[key] !== true) {
        nextErrors[`acceptedLegalConsents.${key}`] = 'checkout.payPage.validation.documentRequired'
      }
    }

    return nextErrors
  }, [
    acceptedLegalConsents,
    customerData,
    effectiveAmount,
    formatAmount,
    payload,
    selectedPriceItemId,
    shouldCollectCustomerDetails,
    t,
  ])

  const backHref = payload
    ? mode === 'template'
      ? `/backend/checkout/templates/${encodeURIComponent(payload.id)}`
      : `/backend/checkout/pay-links/${encodeURIComponent(payload.id)}`
    : '/backend/checkout'

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
        <Card className="rounded-[28px] border-white/70 bg-white/95 shadow-xl">
          <CardHeader>
            <CardTitle>{payload.title ?? t('checkout.payPage.protectedTitle', 'Protected payment link')}</CardTitle>
          </CardHeader>
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

  if (payload.available === false && !isPreview) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">
        {t('checkout.payPage.unavailable', 'This payment link is no longer available.')}
      </div>
    )
  }

  const embeddedRenderer = paymentSession?.type === 'embedded' && paymentSession.providerKey
    ? getEmbeddedPaymentGatewayRenderer(paymentSession.providerKey, paymentSession.rendererKey)
    : null

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6" style={{ background: payload.backgroundColor ?? '#f5f3ee' }}>
      {isPreview ? (
        <div className="mx-auto mb-4 max-w-6xl rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('checkout.payPage.previewBanner', 'Preview mode. Payments are disabled.')}</span>
            <Button asChild type="button" variant="outline">
              <Link href={backHref}>{t('checkout.payPage.actions.backToAdmin', 'Back to admin')}</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,420px)]">
        <Card className="rounded-[28px] border-white/60 bg-white/90 shadow-xl backdrop-blur">
          <CardContent className="space-y-6 p-5 sm:p-6">
            {payload.logoUrl ? (
              <img
                src={payload.logoUrl}
                alt={payload.title ?? payload.name}
                className="h-12 w-auto object-contain"
              />
            ) : null}

            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{payload.title ?? payload.name}</h1>
              {payload.subtitle ? (
                <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{payload.subtitle}</p>
              ) : null}
            </div>

            {payload.description ? (
              <div className="prose prose-sm max-w-none text-foreground">
                <MarkdownContent body={payload.description} format="markdown" />
              </div>
            ) : null}

            {publicCustomFields.length > 0 ? (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">{t('checkout.payPage.sections.productDetails', 'Product details')}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('checkout.payPage.help.productDetails', 'Additional offer details configured for this payment link.')}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {publicCustomFields.map((field) => {
                    const formattedValue = formatPublicFieldValue(field.value)
                    if (!formattedValue.trim().length) return null
                    const isMultiline = field.kind === 'multiline' || formattedValue.includes('\n')
                    return (
                      <div
                        key={field.key}
                        className={isMultiline ? 'rounded-2xl border border-border/70 bg-muted/20 p-4 sm:col-span-2' : 'rounded-2xl border border-border/70 bg-muted/20 p-4'}
                      >
                        <div className="text-sm font-medium">{field.label ?? field.key}</div>
                        <div className={isMultiline ? 'mt-2 whitespace-pre-wrap text-sm text-muted-foreground' : 'mt-2 text-sm text-muted-foreground'}>
                          {formattedValue}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {shouldCollectCustomerDetails ? (
              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">{t('checkout.payPage.sections.customerDetails', 'Customer details')}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('checkout.payPage.help.customerDetails', 'Add the buyer details once, then continue to payment.')}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(payload.customerFieldsSchema ?? []).map((field) => {
                    const fieldPath = `customerData.${field.key}`
                    const fieldError = fieldErrors[fieldPath]
                    const value = customerData[field.key]
                    const containerClass = field.kind === 'multiline' ? 'sm:col-span-2 space-y-2' : 'space-y-2'
                    return (
                      <div key={field.key} className={containerClass}>
                        {field.kind === 'boolean' ? (
                          <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
                            <input
                              type="checkbox"
                              checked={value === true}
                              disabled={inputsLocked}
                              onChange={(event) => updateCustomerField(field.key, event.target.checked)}
                            />
                            <span className="space-y-1">
                              <span className="font-medium">
                                {field.label}
                                {field.required ? ' *' : ''}
                              </span>
                              {field.placeholder ? (
                                <span className="block text-muted-foreground">{field.placeholder}</span>
                              ) : null}
                            </span>
                          </label>
                        ) : (
                          <>
                            <label className="text-sm font-medium">
                              {field.label}
                              {field.required ? ' *' : ''}
                            </label>
                            {field.kind === 'multiline' ? (
                              <Textarea
                                value={typeof value === 'string' ? value : ''}
                                disabled={inputsLocked}
                                onChange={(event) => updateCustomerField(field.key, event.target.value)}
                                placeholder={field.placeholder ?? undefined}
                                className={fieldError ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
                              />
                            ) : field.kind === 'select' || field.kind === 'radio' ? (
                              <select
                                className={`w-full rounded-xl border bg-background px-3 py-2.5 text-sm ${fieldError ? 'border-destructive' : 'border-input'}`}
                                value={typeof value === 'string' ? value : ''}
                                disabled={inputsLocked}
                                onChange={(event) => updateCustomerField(field.key, event.target.value)}
                              >
                                <option value="">{t('checkout.payPage.fields.selectPlaceholder', 'Select...')}</option>
                                {(field.options ?? []).map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                value={typeof value === 'string' ? value : ''}
                                disabled={inputsLocked}
                                onChange={(event) => updateCustomerField(field.key, event.target.value)}
                                placeholder={field.placeholder ?? undefined}
                                className={fieldError ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
                              />
                            )}
                          </>
                        )}
                        {fieldError ? (
                          <p className="text-sm text-destructive">{translateValidationMessage(fieldError, fieldPath)}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-fit rounded-[28px] border-white/60 bg-white/95 shadow-xl backdrop-blur xl:sticky xl:top-6">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{t('checkout.payPage.sections.payment', 'Payment')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('checkout.payPage.help.payment', 'Choose the amount, review the summary, then continue with the secure payment step.')}
              </p>
            </div>

            {payload.pricingMode === 'fixed' ? (
              <div className="rounded-[24px] border border-border/70 bg-muted/20 p-4">
                {typeof payload.fixedPriceOriginalAmount === 'number' ? (
                  <div className="text-sm text-muted-foreground line-through">
                    {formatAmount(payload.fixedPriceOriginalAmount, payload.fixedPriceCurrencyCode)}
                  </div>
                ) : null}
                <div className="mt-1 text-3xl font-semibold">
                  {formatAmount(payload.fixedPriceAmount, payload.fixedPriceCurrencyCode)}
                </div>
              </div>
            ) : null}

            {payload.pricingMode === 'custom_amount' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('checkout.payPage.fields.customAmount', 'Amount')}</label>
                <Input
                  type="number"
                  value={effectiveAmount ?? ''}
                  disabled={inputsLocked}
                  onChange={(event) => {
                    setAmount(parseNumericInput(event.target.value))
                    clearFieldError('amount')
                    setSubmissionError(null)
                  }}
                  placeholder={[
                    payload.customAmountMin != null ? formatAmount(payload.customAmountMin, payload.customAmountCurrencyCode) : null,
                    payload.customAmountMax != null ? formatAmount(payload.customAmountMax, payload.customAmountCurrencyCode) : null,
                  ].filter(Boolean).join(' - ')}
                  className={fieldErrors.amount ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
                />
                {fieldErrors.amount ? (
                  <p className="text-sm text-destructive">{translateValidationMessage(fieldErrors.amount, 'amount')}</p>
                ) : null}
              </div>
            ) : null}

            {payload.pricingMode === 'price_list' ? (
              <div className="space-y-2">
                {(payload.priceListItems ?? []).map((item) => (
                  <label
                    key={item.id}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                      selectedPriceItemId === item.id
                        ? 'border-foreground bg-foreground/[0.03]'
                        : 'border-border/70 bg-background'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="priceItem"
                        checked={selectedPriceItemId === item.id}
                        disabled={inputsLocked}
                        onChange={() => {
                          setSelectedPriceItemId(item.id)
                          setAmount(item.amount)
                          clearFieldError('selectedPriceItemId')
                          setSubmissionError(null)
                        }}
                      />
                      <span className="font-medium">{item.description}</span>
                    </span>
                    <span className="whitespace-nowrap font-semibold">{formatAmount(item.amount, item.currencyCode)}</span>
                  </label>
                ))}
                {fieldErrors.selectedPriceItemId ? (
                  <p className="text-sm text-destructive">
                    {translateValidationMessage(fieldErrors.selectedPriceItemId, 'selectedPriceItemId')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {(payload.legalDocuments?.terms?.markdown || payload.legalDocuments?.privacyPolicy?.markdown) ? (
              <div className="space-y-3 rounded-[24px] border border-border/70 bg-muted/20 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{t('checkout.payPage.sections.legal', 'Legal confirmations')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('checkout.payPage.help.legal', 'Required confirmations must be accepted before the payment step starts.')}
                  </p>
                </div>
                {payload.legalDocuments?.terms?.markdown ? (
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={acceptedLegalConsents.terms === true}
                        disabled={inputsLocked}
                        onChange={(event) => updateConsent('terms', event.target.checked)}
                      />
                      <span>
                        {t(
                          'checkout.payPage.legal.acceptDocument',
                          'I accept {document}.',
                          {
                            document: payload.legalDocuments.terms.title || t('checkout.payPage.legal.defaultTermsTitle', 'the terms and conditions'),
                          },
                        )}
                      </span>
                    </label>
                    {fieldErrors['acceptedLegalConsents.terms'] ? (
                      <p className="text-sm text-destructive">
                        {translateValidationMessage(fieldErrors['acceptedLegalConsents.terms'], 'acceptedLegalConsents.terms')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {payload.legalDocuments?.privacyPolicy?.markdown ? (
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={acceptedLegalConsents.privacyPolicy === true}
                        disabled={inputsLocked}
                        onChange={(event) => updateConsent('privacyPolicy', event.target.checked)}
                      />
                      <span>
                        {t(
                          'checkout.payPage.legal.acceptDocument',
                          'I accept {document}.',
                          {
                            document: payload.legalDocuments.privacyPolicy.title || t('checkout.payPage.legal.defaultPrivacyTitle', 'the privacy policy'),
                          },
                        )}
                      </span>
                    </label>
                    {fieldErrors['acceptedLegalConsents.privacyPolicy'] ? (
                      <p className="text-sm text-destructive">
                        {translateValidationMessage(fieldErrors['acceptedLegalConsents.privacyPolicy'], 'acceptedLegalConsents.privacyPolicy')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-[24px] border border-border/70 bg-foreground px-4 py-4 text-background">
              <div className="text-xs uppercase tracking-[0.16em] text-background/70">
                {t('checkout.payPage.summary.amountDue', 'Amount due')}
              </div>
              <div className="mt-2 text-3xl font-semibold">
                {effectiveAmount != null && effectiveCurrencyCode
                  ? formatAmount(effectiveAmount, effectiveCurrencyCode)
                  : t('checkout.payPage.summary.awaitingSelection', 'Select an amount')}
              </div>
            </div>

            {submissionError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {submissionError}
              </div>
            ) : null}

            {paymentSession && embeddedRenderer ? React.createElement(embeddedRenderer, {
              providerKey: paymentSession.providerKey ?? '',
              transactionId: activeTransactionId ?? '',
              gatewayTransactionId: paymentSession.gatewayTransactionId,
              session: paymentSession,
              disabled: isPreview,
              onComplete: () => {
                if (!activeTransactionId) return
                router.push(`/pay/${encodeURIComponent(slug)}/success/${encodeURIComponent(activeTransactionId)}`)
              },
              onError: (message: string) => {
                setSubmissionError(message)
              },
            }) : (
              <Button
                type="button"
                className="h-12 w-full rounded-2xl text-base"
                disabled={isPreview || isSubmitting}
                onClick={async () => {
                  if (isPreview) return
                  const nextErrors = validateBeforeSubmit()
                  if (Object.keys(nextErrors).length > 0) {
                    setFieldErrors(nextErrors)
                    setSubmissionError(t('checkout.payPage.validation.fixErrors', 'Check the highlighted fields and try again.'))
                    return
                  }

                  setIsSubmitting(true)
                  setSubmissionError(null)
                  setFieldErrors({})

                  try {
                    const result = await readApiResultOrThrow<SubmitResponse>(
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

                    setActiveTransactionId(result.transactionId)

                    if (result.paymentSession?.type === 'embedded') {
                      const nextRenderer = result.paymentSession.providerKey
                        ? getEmbeddedPaymentGatewayRenderer(result.paymentSession.providerKey, result.paymentSession.rendererKey)
                        : null

                      if (nextRenderer) {
                        setPaymentSession(result.paymentSession)
                        return
                      }

                      if (result.redirectUrl) {
                        window.location.href = result.redirectUrl
                        return
                      }

                      setSubmissionError(t(
                        'checkout.payPage.errors.embeddedUnavailable',
                        'The payment form is unavailable right now. Please try again or use the hosted payment page.',
                      ))
                      return
                    }

                    if (result.redirectUrl) {
                      window.location.href = result.redirectUrl
                      return
                    }

                    router.push(`/pay/${encodeURIComponent(slug)}/success/${encodeURIComponent(result.transactionId)}`)
                  } catch (error) {
                    const normalized = mapCrudServerErrorToFormErrors(error)
                    const nextFieldErrors = Object.fromEntries(
                      Object.entries(normalized.fieldErrors ?? {}).map(([fieldPath, message]) => [
                        fieldPath,
                        translateValidationMessage(message, fieldPath),
                      ]),
                    )
                    if (Object.keys(nextFieldErrors).length > 0) {
                      setFieldErrors(nextFieldErrors)
                    }
                    setSubmissionError(
                      translateValidationMessage(
                        normalized.message,
                      ) || t('checkout.payPage.errors.submit', 'Unable to start the payment. Please try again.'),
                    )
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
            )}

            {paymentSession ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full rounded-2xl"
                onClick={() => {
                  setPaymentSession(null)
                  setActiveTransactionId(null)
                  setSubmissionError(null)
                }}
              >
                {t('checkout.payPage.actions.editDetails', 'Edit details')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default PayPage
