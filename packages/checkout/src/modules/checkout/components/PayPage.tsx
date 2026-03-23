"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import type { CustomFieldDisplayEntry } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveLocaleFromCandidates } from '@open-mercato/shared/lib/i18n/locale'
import { getPaymentGatewayRenderer } from '@open-mercato/shared/modules/payment_gateways/client'
import type { PaymentGatewayRendererProps } from '@open-mercato/shared/modules/payment_gateways/client'
import type { PaymentGatewayClientSession } from '@open-mercato/shared/modules/payment_gateways/types'
import { InjectionSpot, useInjectionSpotEvents, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  getCheckoutCustomerFieldSemanticType,
  validateCheckoutCustomerData,
} from '../lib/customerDataValidation'

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

type CheckoutThemeMode = 'light' | 'dark' | 'auto'

export type PayLinkPayload = {
  id: string
  slug?: string | null
  name: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  logoUrl?: string | null
  logoPreviewUrl?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  backgroundColor?: string | null
  themeMode?: CheckoutThemeMode | null
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

type PayPageSubmitData = {
  customerData: Record<string, unknown>
  acceptedLegalConsents: Record<string, boolean>
  amount: number | null
  selectedPriceItemId: string | null
}

export type PayPageThemeTokens = {
  mode: 'light' | 'dark'
  accent: string
  accentSecondary: string
  accentContrast: string
  text: string
  mutedText: string
  pageBackground: string
  shellBackground: string
  surface: string
  surfaceMuted: string
  surfaceStrong: string
  border: string
  borderStrong: string
  shadow: string
  accentShadow: string
  heroBackground: string
  errorText: string
  errorBorder: string
  errorSurface: string
  errorSurfaceStrong: string
  errorRing: string
}

type PayPageInjectionContext = {
  link: PayLinkPayload
  themeMode: 'light' | 'dark'
  themeTokens: PayPageThemeTokens
  preview: boolean
  selectedAmount: number | null
  currencyCode: string | null
  pricingMode: PayLinkPayload['pricingMode']
  customerSchema: CustomerFieldDefinition[]
  customerData: Record<string, unknown>
  legalDocuments: NonNullable<PayLinkPayload['legalDocuments']>
  acceptedLegalConsents: Record<string, boolean>
  transaction: { id: string } | null
  paymentView: 'idle' | 'embedded' | 'redirect'
  paymentSession: SubmitResponse['paymentSession']
  paymentProviderKey: string | null
  paymentRendererKey: string | null
  fieldErrors: FieldErrors
  submissionError: string | null
  inputsLocked: boolean
  isSubmitting: boolean
  canSubmit: boolean
  operation: 'create'
}

export type PayPageSurfaceProps = {
  previewBanner: React.ReactNode
  leftColumn: React.ReactNode
  rightColumn: React.ReactNode
  footer: React.ReactNode
  themeTokens: PayPageThemeTokens
}

export type PayPageHeaderProps = {
  payload: PayLinkPayload
  preview: boolean
  themeTokens: PayPageThemeTokens
}

export type PayPageDescriptionProps = {
  payload: PayLinkPayload
  publicCustomFields: CustomFieldDisplayEntry[]
  themeTokens: PayPageThemeTokens
}

export type PayPageCustomerFormProps = {
  payload: PayLinkPayload
  customerData: Record<string, unknown>
  fieldErrors: FieldErrors
  inputsLocked: boolean
  onFieldChange: (fieldKey: string, value: unknown) => void
  translateValidationMessage: (message: string | null | undefined, fieldPath?: string) => string
  themeTokens: PayPageThemeTokens
}

export type PayPagePricingProps = {
  payload: PayLinkPayload
  amount: number | null
  selectedPriceItemId: string | null
  fieldErrors: FieldErrors
  inputsLocked: boolean
  formatAmount: (value: number | null | undefined, currencyCode?: string | null) => string
  onAmountChange: (value: string) => void
  onPriceItemSelect: (item: PriceListItem) => void
  translateValidationMessage: (message: string | null | undefined, fieldPath?: string) => string
  themeTokens: PayPageThemeTokens
}

export type PayPageSummaryProps = {
  payload: PayLinkPayload
  selectedAmount: number | null
  currencyCode: string | null
  formatAmount: (value: number | null | undefined, currencyCode?: string | null) => string
  preview: boolean
  themeTokens: PayPageThemeTokens
}

export type PayPageLegalConsentProps = {
  payload: PayLinkPayload
  acceptedLegalConsents: Record<string, boolean>
  fieldErrors: FieldErrors
  inputsLocked: boolean
  onConsentChange: (fieldKey: 'terms' | 'privacyPolicy', value: boolean) => void
  translateValidationMessage: (message: string | null | undefined, fieldPath?: string) => string
  themeTokens: PayPageThemeTokens
}

export type PayPagePaymentFormProps = {
  payload: PayLinkPayload
  slug: string
  preview: boolean
  isSubmitting: boolean
  submissionError: string | null
  paymentSession: SubmitResponse['paymentSession']
  activeTransactionId: string | null
  embeddedRenderer: React.ComponentType<PaymentGatewayRendererProps> | null | undefined
  onSubmit: () => Promise<void>
  onReset: () => void
  onComplete: () => void
  onError: (message: string) => void
  injectionContext: PayPageInjectionContext
  themeTokens: PayPageThemeTokens
}

export type PayPagePaymentSectionProps = {
  payload: PayLinkPayload
  preview: boolean
  themeTokens: PayPageThemeTokens
  children: React.ReactNode
}

export type PayPageHelpProps = {
  payload: PayLinkPayload
  preview: boolean
  themeTokens: PayPageThemeTokens
}

export type PayPageFooterProps = {
  payload: PayLinkPayload
  themeTokens: PayPageThemeTokens
}

const PAGE_HANDLE = ComponentReplacementHandles.page('checkout.pay-page')
const HEADER_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'header')
const DESCRIPTION_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'description')
const SUMMARY_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'summary')
const PRICING_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'pricing')
const PAYMENT_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'payment')
const CUSTOMER_FORM_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'customer-form')
const LEGAL_CONSENT_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'legal-consent')
const GATEWAY_FORM_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'gateway-form')
const HELP_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'help')
const FOOTER_HANDLE = ComponentReplacementHandles.section('checkout.pay-page', 'footer')

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function readTranslatedErrorMessage(
  error: unknown,
  translate: (key: string, fallback: string) => string,
  fallback: string,
) {
  return translate(readErrorMessage(error, fallback), fallback)
}

function parseNumericInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function setSubmitDataFieldValue(
  data: PayPageSubmitData,
  fieldPath: string,
  value: unknown,
): PayPageSubmitData {
  if (fieldPath.startsWith('customerData.')) {
    const fieldKey = fieldPath.slice('customerData.'.length)
    return {
      ...data,
      customerData: {
        ...data.customerData,
        [fieldKey]: value,
      },
    }
  }
  if (fieldPath.startsWith('acceptedLegalConsents.')) {
    const fieldKey = fieldPath.slice('acceptedLegalConsents.'.length)
    if (fieldKey === 'terms' || fieldKey === 'privacyPolicy') {
      return {
        ...data,
        acceptedLegalConsents: {
          ...data.acceptedLegalConsents,
          [fieldKey]: value === true,
        },
      }
    }
    return data
  }
  if (fieldPath === 'amount') {
    return {
      ...data,
      amount: typeof value === 'number' && Number.isFinite(value) ? value : null,
    }
  }
  if (fieldPath === 'selectedPriceItemId') {
    return {
      ...data,
      selectedPriceItemId: typeof value === 'string' && value.trim().length > 0 ? value : null,
    }
  }
  return data
}

function applySubmitDataSideEffects(
  data: PayPageSubmitData,
  sideEffects: Record<string, unknown> | undefined,
): PayPageSubmitData {
  if (!sideEffects) return data
  return Object.entries(sideEffects).reduce(
    (current, [fieldPath, value]) => setSubmitDataFieldValue(current, fieldPath, value),
    data,
  )
}

function normalizeHexColor(value: string | null | undefined, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim().replace(/^#/, '') : ''
  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return `#${normalized.split('').map((part) => `${part}${part}`).join('')}`.toUpperCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized}`.toUpperCase()
  }
  return fallback.toUpperCase()
}

function hexToRgb(color: string) {
  const normalized = normalizeHexColor(color, '#000000').replace('#', '')
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  const encode = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
  return `#${encode(rgb.r)}${encode(rgb.g)}${encode(rgb.b)}`.toUpperCase()
}

function mixHexColors(start: string, end: string, weight: number) {
  const from = hexToRgb(start)
  const to = hexToRgb(end)
  const amount = clamp(weight, 0, 1)
  return rgbToHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  })
}

function withAlpha(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

function getContrastText(color: string) {
  const { r, g, b } = hexToRgb(color)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#0F172A' : '#F8FAFC'
}

function resolveThemeTokens(payload: PayLinkPayload | null, prefersDark: boolean): PayPageThemeTokens {
  const accent = normalizeHexColor(payload?.primaryColor, '#1E3A8A')
  const accentSecondary = normalizeHexColor(payload?.secondaryColor, '#F59E0B')
  const requestedMode = payload?.themeMode ?? 'auto'
  const mode = requestedMode === 'dark' || (requestedMode === 'auto' && prefersDark) ? 'dark' : 'light'
  const background = normalizeHexColor(payload?.backgroundColor, mode === 'dark' ? '#0B1020' : '#F5EFE6')
  const text = mode === 'dark' ? '#F8FAFC' : '#111827'
  const mutedText = mode === 'dark' ? '#CBD5E1' : '#6B7280'
  const surface = mixHexColors(background, mode === 'dark' ? '#111827' : '#FFFFFF', mode === 'dark' ? 0.62 : 0.76)
  const surfaceMuted = mixHexColors(accentSecondary, background, mode === 'dark' ? 0.18 : 0.88)
  const surfaceStrong = mixHexColors(accent, background, mode === 'dark' ? 0.22 : 0.9)
  const border = withAlpha(mode === 'dark' ? '#E2E8F0' : accent, mode === 'dark' ? 0.16 : 0.14)
  const borderStrong = withAlpha(accent, mode === 'dark' ? 0.34 : 0.22)
  const shellBackground = mixHexColors(background, mode === 'dark' ? '#020617' : '#FFFDF8', mode === 'dark' ? 0.82 : 0.64)
  const heroStart = withAlpha(accent, mode === 'dark' ? 0.26 : 0.16)
  const heroEnd = withAlpha(accentSecondary, mode === 'dark' ? 0.22 : 0.2)
  const errorBase = mode === 'dark' ? '#F87171' : '#DC2626'

  return {
    mode,
    accent,
    accentSecondary,
    accentContrast: getContrastText(accent),
    text,
    mutedText,
    pageBackground: `
      radial-gradient(circle at top left, ${withAlpha(accent, mode === 'dark' ? 0.2 : 0.12)} 0%, transparent 38%),
      radial-gradient(circle at bottom right, ${withAlpha(accentSecondary, mode === 'dark' ? 0.24 : 0.15)} 0%, transparent 34%),
      linear-gradient(140deg, ${background} 0%, ${shellBackground} 100%)
    `,
    shellBackground,
    surface,
    surfaceMuted,
    surfaceStrong,
    border,
    borderStrong,
    shadow: mode === 'dark'
      ? `0 32px 80px ${withAlpha('#020617', 0.55)}`
      : `0 28px 72px ${withAlpha(accent, 0.12)}`,
    accentShadow: `0 22px 48px ${withAlpha(accent, mode === 'dark' ? 0.3 : 0.22)}`,
    heroBackground: `linear-gradient(145deg, ${heroStart} 0%, ${heroEnd} 100%)`,
    errorText: mode === 'dark' ? '#FCA5A5' : '#B91C1C',
    errorBorder: errorBase,
    errorSurface: withAlpha(errorBase, mode === 'dark' ? 0.14 : 0.08),
    errorSurfaceStrong: withAlpha(errorBase, mode === 'dark' ? 0.2 : 0.12),
    errorRing: withAlpha(errorBase, mode === 'dark' ? 0.28 : 0.18),
  }
}

function buildReadableInputStyle(themeTokens: PayPageThemeTokens, hasError: boolean): React.CSSProperties {
  return {
    background: 'rgba(255, 255, 255, 0.96)',
    color: '#0F172A',
    borderColor: hasError ? themeTokens.errorBorder : withAlpha('#0F172A', 0.12),
    boxShadow: hasError ? `0 0 0 3px ${themeTokens.errorRing}` : undefined,
  }
}

function buildValidationMessageStyle(themeTokens: PayPageThemeTokens): React.CSSProperties {
  return {
    color: themeTokens.errorText,
    fontWeight: 500,
  }
}

function buildValidationNoticeStyle(themeTokens: PayPageThemeTokens): React.CSSProperties {
  return {
    borderColor: themeTokens.errorBorder,
    background: themeTokens.errorSurface,
    color: themeTokens.errorText,
    boxShadow: `0 0 0 1px ${themeTokens.errorSurfaceStrong} inset`,
  }
}

function formatPublicFieldValue(value: unknown, booleanLabels?: { trueLabel: string; falseLabel: string }): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ')
  if (typeof value === 'boolean') {
    if (booleanLabels) return value ? booleanLabels.trueLabel : booleanLabels.falseLabel
    return value ? 'Yes' : 'No'
  }
  if (value == null) return ''
  return String(value)
}

function usePrefersDarkMode() {
  const [prefersDark, setPrefersDark] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updatePreference = () => setPrefersDark(mediaQuery.matches)
    updatePreference()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updatePreference)
      return () => mediaQuery.removeEventListener('change', updatePreference)
    }
    mediaQuery.addListener(updatePreference)
    return () => mediaQuery.removeListener(updatePreference)
  }, [])

  return prefersDark
}

function hasStoredLocalePreference() {
  if (typeof document === 'undefined') return false

  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith('locale='))
}

async function persistLocalePreference(locale: Locale) {
  const response = await fetch('/api/auth/locale', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  })

  return response.ok
}

function buildPanelStyle(themeTokens: PayPageThemeTokens, variant: 'default' | 'muted' | 'hero' | 'accent' = 'default'): React.CSSProperties {
  if (variant === 'hero') {
    return {
      background: themeTokens.heroBackground,
      borderColor: themeTokens.borderStrong,
      boxShadow: themeTokens.shadow,
      color: themeTokens.text,
    }
  }
  if (variant === 'accent') {
    return {
      background: `linear-gradient(145deg, ${themeTokens.accent} 0%, ${mixHexColors(themeTokens.accent, themeTokens.accentSecondary, 0.4)} 100%)`,
      borderColor: withAlpha(themeTokens.accentContrast, 0.12),
      boxShadow: themeTokens.accentShadow,
      color: themeTokens.accentContrast,
    }
  }
  return {
    background: variant === 'muted' ? themeTokens.surfaceMuted : themeTokens.surface,
    borderColor: variant === 'muted' ? themeTokens.borderStrong : themeTokens.border,
    boxShadow: themeTokens.shadow,
    color: themeTokens.text,
  }
}

function buildButtonStyle(themeTokens: PayPageThemeTokens, variant: 'solid' | 'outline' = 'solid'): React.CSSProperties {
  if (variant === 'outline') {
    return {
      borderColor: themeTokens.borderStrong,
      color: themeTokens.text,
      background: withAlpha(themeTokens.surface, 0.72),
    }
  }
  return {
    background: themeTokens.accent,
    color: themeTokens.accentContrast,
    boxShadow: themeTokens.accentShadow,
  }
}

const READABLE_INPUT_CLASSNAME = 'border bg-white/95 text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60'

export function PayPageSurface({
  previewBanner,
  leftColumn,
  rightColumn,
  footer,
  themeTokens,
}: PayPageSurfaceProps) {
  return (
    <div
      className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-10"
      style={{ background: themeTokens.pageBackground, color: themeTokens.text }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-10%] top-[-5%] h-80 w-80 rounded-full blur-3xl"
        style={{ background: withAlpha(themeTokens.accent, 0.16) }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-8%] right-[-4%] h-96 w-96 rounded-full blur-3xl"
        style={{ background: withAlpha(themeTokens.accentSecondary, 0.16) }}
      />

      <div className="relative mx-auto max-w-7xl space-y-6">
        {previewBanner}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(360px,430px)] lg:items-start">
          <div className="space-y-6">{leftColumn}</div>
          <div className="space-y-6 lg:sticky lg:top-6">{rightColumn}</div>
        </div>
        {footer}
      </div>
    </div>
  )
}

export function PayPageHeader({ payload, preview, themeTokens }: PayPageHeaderProps) {
  const t = useT()
  const resolvedLogoUrl = payload.logoPreviewUrl ?? payload.logoUrl ?? null

  return (
    <section
      className="relative overflow-hidden rounded-[32px] border p-6 sm:p-8"
      style={buildPanelStyle(themeTokens, 'hero')}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-4rem] top-[-3rem] h-40 w-40 rounded-full blur-3xl"
        style={{ background: withAlpha(themeTokens.accentSecondary, 0.22) }}
      />
      <div className="relative flex flex-col gap-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]"
              style={{
                background: withAlpha(themeTokens.accent, 0.14),
                color: themeTokens.text,
              }}
            >
              {t('checkout.payPage.badges.secure', 'Secure checkout')}
            </span>
            {preview ? (
              <span
                className="inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
                style={{
                  background: withAlpha(themeTokens.accentSecondary, 0.16),
                  color: themeTokens.text,
                }}
              >
                {t('checkout.payPage.badges.preview', 'Preview')}
              </span>
            ) : null}
          </div>

          {resolvedLogoUrl ? (
            <img
              src={resolvedLogoUrl}
              alt={payload.title ?? payload.name}
              className="h-14 w-auto max-w-[180px] object-contain"
            />
          ) : null}

          <div className="space-y-3">
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              {payload.title ?? payload.name}
            </h1>
            {payload.subtitle ? (
              <p className="max-w-2xl text-base leading-7" style={{ color: themeTokens.mutedText }}>
                {payload.subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export function PayPageDescription({ payload, publicCustomFields, themeTokens }: PayPageDescriptionProps) {
  const t = useT()
  const hasDescription = Boolean(payload.description)
  const visibleFields = publicCustomFields.filter((field) => {
    const formattedValue = formatPublicFieldValue(field.value, {
      trueLabel: t('checkout.payPage.fields.booleanTrue', 'Yes'),
      falseLabel: t('checkout.payPage.fields.booleanFalse', 'No'),
    })
    return formattedValue.trim().length > 0
  })

  if (!hasDescription && visibleFields.length === 0) return null

  return (
    <section
      className="space-y-5 rounded-[30px] border p-6 sm:p-7"
      style={buildPanelStyle(themeTokens, 'default')}
    >
      {hasDescription ? (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: themeTokens.mutedText }}>
            {t('checkout.payPage.description.kicker', 'Offer overview')}
          </div>
          <div className="prose prose-sm max-w-none">
            <MarkdownContent body={payload.description ?? ''} format="markdown" />
          </div>
        </div>
      ) : null}

      {visibleFields.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('checkout.payPage.sections.productDetails', 'Product details')}</h2>
            <p className="text-sm" style={{ color: themeTokens.mutedText }}>
              {t('checkout.payPage.help.productDetails', 'Additional offer details configured for this payment link.')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {visibleFields.map((field) => {
              const formattedValue = formatPublicFieldValue(field.value, {
                trueLabel: t('checkout.payPage.fields.booleanTrue', 'Yes'),
                falseLabel: t('checkout.payPage.fields.booleanFalse', 'No'),
              })
              const isMultiline = field.kind === 'multiline' || formattedValue.includes('\n')

              return (
                <div
                  key={field.key}
                  className={isMultiline ? 'rounded-[24px] border p-4 sm:col-span-2' : 'rounded-[24px] border p-4'}
                  style={{
                    background: withAlpha(themeTokens.shellBackground, 0.72),
                    borderColor: themeTokens.border,
                  }}
                >
                  <div className="text-sm font-medium">{field.label ?? field.key}</div>
                  <div
                    className={isMultiline ? 'mt-2 whitespace-pre-wrap text-sm' : 'mt-2 text-sm'}
                    style={{ color: themeTokens.mutedText }}
                  >
                    {formattedValue}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function PayPageCustomerForm({
  payload,
  customerData,
  fieldErrors,
  inputsLocked,
  onFieldChange,
  translateValidationMessage,
  themeTokens,
}: PayPageCustomerFormProps) {
  const t = useT()

  if ((payload.customerFieldsSchema?.length ?? 0) === 0 || payload.collectCustomerDetails === false) {
    return null
  }

  return (
    <section
      className="space-y-5 rounded-[30px] border p-6 sm:p-7"
      style={buildPanelStyle(themeTokens, 'default')}
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{t('checkout.payPage.sections.customerDetails', 'Customer details')}</h2>
        <p className="text-sm" style={{ color: themeTokens.mutedText }}>
          {t('checkout.payPage.help.customerDetails', 'Add the buyer details once, then continue to payment.')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(payload.customerFieldsSchema ?? []).map((field) => {
          const fieldPath = `customerData.${field.key}`
          const fieldError = fieldErrors[fieldPath]
          const value = customerData[field.key]
          const containerClass = field.kind === 'multiline' ? 'space-y-2 sm:col-span-2' : 'space-y-2'
          const semanticType = getCheckoutCustomerFieldSemanticType(field)

          return (
            <div key={field.key} className={containerClass}>
              {field.kind === 'boolean' ? (
                <label
                  className="flex items-start gap-3 rounded-[24px] border px-4 py-3 text-sm"
                  style={{
                    background: fieldError
                      ? themeTokens.errorSurface
                      : withAlpha(themeTokens.shellBackground, 0.72),
                    borderColor: fieldError ? themeTokens.errorBorder : themeTokens.border,
                    boxShadow: fieldError ? `0 0 0 2px ${themeTokens.errorRing}` : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={value === true}
                    disabled={inputsLocked}
                    onChange={(event) => onFieldChange(field.key, event.target.checked)}
                  />
                  <span className="space-y-1">
                    <span className="font-medium">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </span>
                    {field.placeholder ? (
                      <span className="block" style={{ color: themeTokens.mutedText }}>
                        {field.placeholder}
                      </span>
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
                      className={READABLE_INPUT_CLASSNAME}
                      value={typeof value === 'string' ? value : ''}
                      disabled={inputsLocked}
                      onChange={(event) => onFieldChange(field.key, event.target.value)}
                      placeholder={field.placeholder ?? undefined}
                      style={buildReadableInputStyle(themeTokens, Boolean(fieldError))}
                    />
                  ) : field.kind === 'select' || field.kind === 'radio' ? (
                    <select
                      className={`w-full rounded-xl px-3 py-2.5 text-sm ${READABLE_INPUT_CLASSNAME}`}
                      value={typeof value === 'string' ? value : ''}
                      disabled={inputsLocked}
                      onChange={(event) => onFieldChange(field.key, event.target.value)}
                      style={buildReadableInputStyle(themeTokens, Boolean(fieldError))}
                    >
                      <option value="">{t('checkout.payPage.fields.selectPlaceholder', 'Select...')}</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className={READABLE_INPUT_CLASSNAME}
                      type={semanticType === 'email' ? 'email' : semanticType === 'phone' ? 'tel' : 'text'}
                      value={typeof value === 'string' ? value : ''}
                      disabled={inputsLocked}
                      onChange={(event) => onFieldChange(field.key, event.target.value)}
                      placeholder={field.placeholder ?? undefined}
                      autoComplete={semanticType === 'email' ? 'email' : semanticType === 'phone' ? 'tel' : undefined}
                      style={buildReadableInputStyle(themeTokens, Boolean(fieldError))}
                    />
                  )}
                </>
              )}
              {fieldError ? (
                <p className="text-sm" style={buildValidationMessageStyle(themeTokens)}>
                  {translateValidationMessage(fieldError, fieldPath)}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function PayPagePricing({
  payload,
  amount,
  selectedPriceItemId,
  fieldErrors,
  inputsLocked,
  formatAmount,
  onAmountChange,
  onPriceItemSelect,
  translateValidationMessage,
  themeTokens,
}: PayPagePricingProps) {
  const t = useT()

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: themeTokens.mutedText }}>
          {t('checkout.payPage.pricing.kicker', 'Payment setup')}
        </div>
        <h2 className="text-lg font-semibold">{t('checkout.payPage.pricing.title', 'Choose how you want to pay')}</h2>
      </div>

      {payload.pricingMode === 'fixed' ? (
        <div className="rounded-[26px] border p-5" style={buildPanelStyle(themeTokens, 'default')}>
          {typeof payload.fixedPriceOriginalAmount === 'number' ? (
            <div className="text-sm line-through" style={{ color: themeTokens.mutedText }}>
              {formatAmount(payload.fixedPriceOriginalAmount, payload.fixedPriceCurrencyCode)}
            </div>
          ) : null}
          <div className="mt-1 text-4xl font-semibold">
            {formatAmount(payload.fixedPriceAmount, payload.fixedPriceCurrencyCode)}
          </div>
        </div>
      ) : null}

      {payload.pricingMode === 'custom_amount' ? (
        <div className="space-y-2 rounded-[26px] border p-5" style={buildPanelStyle(themeTokens, 'default')}>
          <label className="text-sm font-medium">{t('checkout.payPage.fields.customAmount', 'Amount')}</label>
          <Input
            className={READABLE_INPUT_CLASSNAME}
            type="number"
            value={amount ?? ''}
            disabled={inputsLocked}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder={[
              payload.customAmountMin != null ? formatAmount(payload.customAmountMin, payload.customAmountCurrencyCode) : null,
              payload.customAmountMax != null ? formatAmount(payload.customAmountMax, payload.customAmountCurrencyCode) : null,
            ].filter(Boolean).join(' - ')}
            style={buildReadableInputStyle(themeTokens, Boolean(fieldErrors.amount))}
          />
          {fieldErrors.amount ? (
            <p className="text-sm" style={buildValidationMessageStyle(themeTokens)}>
              {translateValidationMessage(fieldErrors.amount, 'amount')}
            </p>
          ) : null}
        </div>
      ) : null}

      {payload.pricingMode === 'price_list' ? (
        <div className="space-y-3">
          {(payload.priceListItems ?? []).map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-[24px] border px-4 py-4 text-sm transition"
              style={{
                background: selectedPriceItemId === item.id
                  ? withAlpha(themeTokens.accent, 0.08)
                  : withAlpha(themeTokens.shellBackground, 0.66),
                borderColor: selectedPriceItemId === item.id
                  ? themeTokens.borderStrong
                  : themeTokens.border,
              }}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="priceItem"
                  checked={selectedPriceItemId === item.id}
                  disabled={inputsLocked}
                  onChange={() => onPriceItemSelect(item)}
                />
                <span className="font-medium">{item.description}</span>
              </span>
              <span className="whitespace-nowrap font-semibold">{formatAmount(item.amount, item.currencyCode)}</span>
            </label>
          ))}
          {fieldErrors.selectedPriceItemId ? (
            <p className="text-sm" style={buildValidationMessageStyle(themeTokens)}>
              {translateValidationMessage(fieldErrors.selectedPriceItemId, 'selectedPriceItemId')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function PayPageSummary({
  payload,
  selectedAmount,
  currencyCode,
  formatAmount,
  preview,
  themeTokens,
}: PayPageSummaryProps) {
  const t = useT()
  const amountLabel = selectedAmount != null && currencyCode
    ? formatAmount(selectedAmount, currencyCode)
    : t('checkout.payPage.summary.awaitingSelection', 'Select an amount')

  return (
    <section className="rounded-[28px] border p-5" style={buildPanelStyle(themeTokens, 'accent')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-current/70">
            {t('checkout.payPage.summary.amountDue', 'Amount due')}
          </div>
          <div className="mt-2 text-4xl font-semibold">{amountLabel}</div>
        </div>
        <div
          className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
          style={{ background: withAlpha(themeTokens.accentContrast, 0.12) }}
        >
          {preview
            ? t('checkout.payPage.summary.previewState', 'Preview')
            : t('checkout.payPage.summary.liveState', 'Live')}
        </div>
      </div>
    </section>
  )
}

export function PayPageLegalConsent({
  payload,
  acceptedLegalConsents,
  fieldErrors,
  inputsLocked,
  onConsentChange,
  translateValidationMessage,
  themeTokens,
}: PayPageLegalConsentProps) {
  const t = useT()
  const [activeDocument, setActiveDocument] = React.useState<'terms' | 'privacyPolicy' | null>(null)
  const hasTerms = Boolean(payload.legalDocuments?.terms?.markdown)
  const hasPrivacyPolicy = Boolean(payload.legalDocuments?.privacyPolicy?.markdown)
  const activeDocumentPayload = activeDocument ? payload.legalDocuments?.[activeDocument] : null

  if (!hasTerms && !hasPrivacyPolicy) return null

  return (
    <>
      <section className="space-y-4 rounded-[26px] border p-5" style={buildPanelStyle(themeTokens, 'default')}>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{t('checkout.payPage.sections.legal', 'Legal confirmations')}</h3>
          <p className="text-sm" style={{ color: themeTokens.mutedText }}>
            {t('checkout.payPage.help.legal', 'Required confirmations must be accepted before the payment step starts.')}
          </p>
        </div>

        {hasTerms ? (
          <div className="space-y-2">
            <div
              className="rounded-[22px] border px-4 py-3"
              style={{
                background: withAlpha(themeTokens.shellBackground, 0.72),
                borderColor: fieldErrors['acceptedLegalConsents.terms'] ? themeTokens.errorBorder : themeTokens.border,
              }}
            >
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={acceptedLegalConsents.terms === true}
                  disabled={inputsLocked}
                  onChange={(event) => onConsentChange('terms', event.target.checked)}
                />
                <span className="space-y-2">
                  <span className="block">
                    {t(
                      'checkout.payPage.legal.acceptDocument',
                      'I accept {document}.',
                      {
                        document: payload.legalDocuments?.terms?.title || t('checkout.payPage.legal.defaultTermsTitle', 'the terms and conditions'),
                      },
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm font-medium underline"
                    style={{ color: themeTokens.text }}
                    onClick={() => setActiveDocument('terms')}
                  >
                    {t('checkout.payPage.legal.readDocument', 'Read document')}
                  </Button>
                </span>
              </label>
            </div>
            {fieldErrors['acceptedLegalConsents.terms'] ? (
              <p className="text-sm" style={buildValidationMessageStyle(themeTokens)}>
                {translateValidationMessage(fieldErrors['acceptedLegalConsents.terms'], 'acceptedLegalConsents.terms')}
              </p>
            ) : null}
          </div>
        ) : null}

        {hasPrivacyPolicy ? (
          <div className="space-y-2">
            <div
              className="rounded-[22px] border px-4 py-3"
              style={{
                background: withAlpha(themeTokens.shellBackground, 0.72),
                borderColor: fieldErrors['acceptedLegalConsents.privacyPolicy'] ? themeTokens.errorBorder : themeTokens.border,
              }}
            >
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={acceptedLegalConsents.privacyPolicy === true}
                  disabled={inputsLocked}
                  onChange={(event) => onConsentChange('privacyPolicy', event.target.checked)}
                />
                <span className="space-y-2">
                  <span className="block">
                    {t(
                      'checkout.payPage.legal.acceptDocument',
                      'I accept {document}.',
                      {
                        document: payload.legalDocuments?.privacyPolicy?.title || t('checkout.payPage.legal.defaultPrivacyTitle', 'the privacy policy'),
                      },
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm font-medium underline"
                    style={{ color: themeTokens.text }}
                    onClick={() => setActiveDocument('privacyPolicy')}
                  >
                    {t('checkout.payPage.legal.readDocument', 'Read document')}
                  </Button>
                </span>
              </label>
            </div>
            {fieldErrors['acceptedLegalConsents.privacyPolicy'] ? (
              <p className="text-sm" style={buildValidationMessageStyle(themeTokens)}>
                {translateValidationMessage(fieldErrors['acceptedLegalConsents.privacyPolicy'], 'acceptedLegalConsents.privacyPolicy')}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <Dialog open={activeDocument !== null} onOpenChange={(open) => { if (!open) setActiveDocument(null) }}>
        <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {activeDocumentPayload?.title
                || (activeDocument === 'privacyPolicy'
                  ? t('checkout.payPage.legal.defaultPrivacyTitle', 'the privacy policy')
                  : t('checkout.payPage.legal.defaultTermsTitle', 'the terms and conditions'))}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto pr-2">
            <div className="prose prose-sm max-w-none">
              <MarkdownContent body={activeDocumentPayload?.markdown ?? ''} format="markdown" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PayPagePaymentForm({
  payload,
  slug,
  preview,
  isSubmitting,
  submissionError,
  paymentSession,
  activeTransactionId,
  embeddedRenderer,
  onSubmit,
  onReset,
  onComplete,
  onError,
  injectionContext,
  themeTokens,
}: PayPagePaymentFormProps) {
  const t = useT()
  const embeddedPaymentSession = paymentSession?.type === 'embedded' ? paymentSession : null

  return (
    <section className="space-y-4">
      {submissionError ? (
        <div className="rounded-[22px] border px-4 py-3 text-sm" style={buildValidationNoticeStyle(themeTokens)}>
          {submissionError}
        </div>
      ) : null}

      <InjectionSpot spotId="checkout.pay-page:gateway-widget:before" context={injectionContext} />
      {embeddedPaymentSession && embeddedRenderer ? (
        <>
          <InjectionSpot spotId="checkout.pay-page:gateway-widget:renderer:before" context={injectionContext} />
          {React.createElement(embeddedRenderer, {
            providerKey: embeddedPaymentSession.providerKey ?? '',
            transactionId: activeTransactionId ?? '',
            gatewayTransactionId: embeddedPaymentSession.gatewayTransactionId,
            session: embeddedPaymentSession,
            disabled: preview,
            onComplete,
            onError,
          })}
          <InjectionSpot spotId="checkout.pay-page:gateway-widget:renderer:after" context={injectionContext} />
        </>
      ) : (
        <>
          <InjectionSpot spotId="checkout.pay-page:gateway-widget:actions:before" context={injectionContext} />
          <Button
            type="button"
            className="h-12 w-full rounded-2xl text-base"
            disabled={preview || isSubmitting}
            style={buildButtonStyle(themeTokens)}
            onClick={() => { void onSubmit() }}
          >
            <span className="flex items-center justify-center gap-2">
              {isSubmitting ? <Spinner size="sm" /> : null}
              {preview
                ? t('checkout.payPage.actions.previewDisabled', 'Preview only')
                : isSubmitting
                  ? t('checkout.payPage.actions.processingPayment', 'Processing payment...')
                  : t('checkout.payPage.actions.payNow', 'Pay now')}
            </span>
          </Button>
          <InjectionSpot spotId="checkout.pay-page:gateway-widget:actions:after" context={injectionContext} />
        </>
      )}
      <InjectionSpot spotId="checkout.pay-page:gateway-widget:after" context={injectionContext} />

      {paymentSession ? (
        <Button
          type="button"
          variant="outline"
          className="w-full rounded-2xl"
          style={buildButtonStyle(themeTokens, 'outline')}
          onClick={onReset}
        >
          {t('checkout.payPage.actions.editDetails', 'Edit details')}
        </Button>
      ) : null}

      {payload.gatewayProviderKey ? (
        <div className="text-center text-xs" style={{ color: themeTokens.mutedText }}>
          {t('checkout.payPage.payment.providerHint', 'Your payment will be handled by {provider}.', {
            provider: payload.gatewayProviderKey,
          })}
        </div>
      ) : null}

      <div className="hidden text-xs" data-pay-link-slug={slug} />
    </section>
  )
}

export function PayPagePaymentSection({ payload, preview, themeTokens, children }: PayPagePaymentSectionProps) {
  const t = useT()

  return (
    <Card
      className="overflow-hidden rounded-[32px] border backdrop-blur"
      style={{
        ...buildPanelStyle(themeTokens, 'default'),
        background: `linear-gradient(180deg, ${withAlpha(themeTokens.surface, 0.96)} 0%, ${withAlpha(themeTokens.shellBackground, 0.94)} 100%)`,
      }}
    >
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: themeTokens.mutedText }}>
                {t('checkout.payPage.payment.kicker', 'Payment rail')}
              </div>
              <h2 className="mt-1 text-xl font-semibold">{t('checkout.payPage.sections.payment', 'Payment')}</h2>
            </div>
            <div
              className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{
                background: withAlpha(preview ? themeTokens.accentSecondary : themeTokens.accent, 0.12),
                color: themeTokens.text,
              }}
            >
              {preview
                ? t('checkout.payPage.payment.previewState', 'No charge')
                : t('checkout.payPage.payment.liveState', 'Ready')}
            </div>
          </div>
          <p className="text-sm" style={{ color: themeTokens.mutedText }}>
            {t('checkout.payPage.help.payment', 'Choose the amount, review the summary, then continue with the secure payment step.')}
          </p>
          {payload.gatewayProviderKey ? (
            <div className="text-sm font-medium">{payload.gatewayProviderKey}</div>
          ) : null}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export function PayPageHelp({ payload, preview, themeTokens }: PayPageHelpProps) {
  const t = useT()

  return (
    <section
      className="rounded-[24px] border px-4 py-4 text-sm"
      style={{
        background: withAlpha(themeTokens.shellBackground, 0.7),
        borderColor: themeTokens.border,
        color: themeTokens.mutedText,
      }}
    >
      <div className="font-medium" style={{ color: themeTokens.text }}>
        {preview
          ? t('checkout.payPage.help.previewHeadline', 'This is a preview of the payment flow.')
          : t('checkout.payPage.help.liveHeadline', 'The provider widget appears in this panel after validation.')}
      </div>
      <div className="mt-2">
        {payload.gatewayProviderKey
          ? t('checkout.payPage.help.providerLine', 'Provider: {provider}.', { provider: payload.gatewayProviderKey })
          : t('checkout.payPage.help.providerFallback', 'The payment provider is configured in the checkout settings.')}
      </div>
    </section>
  )
}

export function PayPageFooter({ payload, themeTokens }: PayPageFooterProps) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const selectId = React.useId()
  const [pending, startTransition] = React.useTransition()

  const languageLabels = React.useMemo<Record<Locale, string>>(() => ({
    en: t('common.languages.english', 'English'),
    pl: t('common.languages.polish', 'Polski'),
    es: t('common.languages.spanish', 'Español'),
    de: t('common.languages.german', 'Deutsch'),
  }), [t])

  const setLocale = React.useCallback(async (nextLocale: Locale) => {
    if (nextLocale === locale) return

    try {
      const updated = await persistLocalePreference(nextLocale)
      if (!updated) return

      startTransition(() => router.refresh())
    } catch {
      // Keep the current locale when persistence fails.
    }
  }, [locale, router, startTransition])

  React.useEffect(() => {
    if (hasStoredLocalePreference() || typeof navigator === 'undefined') return

    const preferredLocale = resolveLocaleFromCandidates([
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ])

    if (!preferredLocale) return

    let active = true

    void (async () => {
      try {
        const updated = await persistLocalePreference(preferredLocale)
        if (!updated || !active || preferredLocale === locale) return

        startTransition(() => router.refresh())
      } catch {
        // Keep the current locale when auto-detection persistence fails.
      }
    })()

    return () => {
      active = false
    }
  }, [locale, router, startTransition])

  return (
    <footer
      className="rounded-[28px] border px-5 py-4 text-sm sm:px-6"
      style={{
        background: withAlpha(themeTokens.surface, 0.86),
        borderColor: themeTokens.border,
        color: themeTokens.mutedText,
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium" style={{ color: themeTokens.text }}>{payload.title ?? payload.name}</div>
          <div>{t('checkout.payPage.footer.subtitle', 'Public payment page configured in checkout.')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <div className="flex items-center gap-2 text-xs" style={{ color: themeTokens.mutedText }}>
            <label htmlFor={selectId}>{t('common.language', 'Language')}</label>
            <div className="relative">
              <select
                id={selectId}
                className="appearance-none rounded-full border px-3 py-1.5 pr-8 text-xs font-medium shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: withAlpha(themeTokens.surface, 0.92),
                  borderColor: themeTokens.borderStrong,
                  color: themeTokens.text,
                }}
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
                disabled={pending}
              >
                {locales.map((entry) => (
                  <option key={entry} value={entry}>
                    {languageLabels[entry]}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]"
                style={{ color: themeTokens.mutedText }}
              >
                ▼
              </span>
            </div>
          </div>
          <div className="text-xs uppercase tracking-[0.22em]">
            {payload.gatewayProviderKey ?? t('checkout.payPage.header.autoProvider', 'Configured in checkout')}
          </div>
        </div>
      </div>
    </footer>
  )
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
  const prefersDark = usePrefersDarkMode()

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

  const themeTokens = React.useMemo(
    () => resolveThemeTokens(payload, prefersDark),
    [payload, prefersDark],
  )

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
    if (initialPayload) return
    void loadPayload()
  }, [initialPayload, loadPayload, slug])

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
  const submitData = React.useMemo<PayPageSubmitData>(() => ({
    customerData,
    acceptedLegalConsents,
    amount: effectiveAmount ?? null,
    selectedPriceItemId,
  }), [acceptedLegalConsents, customerData, effectiveAmount, selectedPriceItemId])

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

  const applySubmitDataToState = React.useCallback((nextData: PayPageSubmitData) => {
    setCustomerData(nextData.customerData)
    setAcceptedLegalConsents(nextData.acceptedLegalConsents)
    setAmount(nextData.amount)
    setSelectedPriceItemId(nextData.selectedPriceItemId)
  }, [])

  const validateBeforeSubmit = React.useCallback((): FieldErrors => {
    if (!payload) return {}
    const nextErrors: FieldErrors = {}

    if (shouldCollectCustomerDetails) {
      Object.assign(
        nextErrors,
        validateCheckoutCustomerData(payload.customerFieldsSchema ?? [], customerData),
      )
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

  const embeddedRenderer = paymentSession?.type === 'embedded' && paymentSession.providerKey
    ? getPaymentGatewayRenderer(paymentSession.providerKey, paymentSession.rendererKey)
    : null

  const paymentView: PayPageInjectionContext['paymentView'] = paymentSession == null
    ? 'idle'
    : embeddedRenderer
      ? 'embedded'
      : 'redirect'

  const injectionContext = React.useMemo<PayPageInjectionContext | null>(() => {
    if (!payload) return null
    return {
      link: payload,
      themeMode: themeTokens.mode,
      themeTokens,
      preview: isPreview,
      selectedAmount: effectiveAmount ?? null,
      currencyCode: effectiveCurrencyCode,
      pricingMode: payload.pricingMode,
      customerSchema: payload.customerFieldsSchema ?? [],
      customerData,
      legalDocuments: payload.legalDocuments ?? {},
      acceptedLegalConsents,
      transaction: activeTransactionId ? { id: activeTransactionId } : null,
      paymentView,
      paymentSession,
      paymentProviderKey: paymentSession?.providerKey ?? payload.gatewayProviderKey ?? null,
      paymentRendererKey: paymentSession?.type === 'embedded' ? paymentSession.rendererKey : null,
      fieldErrors,
      submissionError,
      inputsLocked,
      isSubmitting,
      canSubmit: !isPreview && !inputsLocked,
      operation: 'create',
    }
  }, [
    acceptedLegalConsents,
    activeTransactionId,
    customerData,
    effectiveAmount,
    effectiveCurrencyCode,
    isPreview,
    isSubmitting,
    inputsLocked,
    payload,
    fieldErrors,
    paymentSession,
    paymentView,
    submissionError,
    themeTokens,
  ])

  const injectionContextRef = React.useRef<PayPageInjectionContext | null>(injectionContext)
  const submitDataRef = React.useRef(submitData)

  React.useEffect(() => {
    injectionContextRef.current = injectionContext
  }, [injectionContext])

  React.useEffect(() => {
    submitDataRef.current = submitData
  }, [submitData])

  const { widgets: payPageFormWidgets } = useInjectionWidgets<PayPageInjectionContext>(
    injectionContext ? 'checkout.pay-page:form' : null,
    {
      context: injectionContext ?? undefined,
      triggerOnLoad: true,
    },
  )
  const { triggerEvent: triggerPayPageFormEvent } = useInjectionSpotEvents<PayPageInjectionContext, PayPageSubmitData>(
    'checkout.pay-page:form',
    payPageFormWidgets,
  )

  const transformValidationErrors = React.useCallback(async (nextErrors: FieldErrors): Promise<FieldErrors> => {
    if (!injectionContextRef.current || !Object.keys(nextErrors).length) return nextErrors
    try {
      const result = await triggerPayPageFormEvent(
        'transformValidation',
        nextErrors as unknown as PayPageSubmitData,
        injectionContextRef.current,
        { originalData: submitDataRef.current },
      )
      const transformed = result.data
      if (!transformed || typeof transformed !== 'object' || Array.isArray(transformed)) {
        return nextErrors
      }
      return Object.fromEntries(
        Object.entries(transformed as Record<string, unknown>).map(([fieldPath, value]) => [fieldPath, String(value)]),
      )
    } catch (error) {
      console.error('[PayPage] Error in transformValidation:', error)
      return nextErrors
    }
  }, [triggerPayPageFormEvent])

  const dispatchFieldChange = React.useCallback((fieldPath: string, value: unknown, nextData: PayPageSubmitData) => {
    if (!injectionContextRef.current) return
    void (async () => {
      try {
        const result = await triggerPayPageFormEvent(
          'onFieldChange',
          nextData,
          injectionContextRef.current as PayPageInjectionContext,
          {
            fieldId: fieldPath,
            fieldValue: value,
            originalData: submitDataRef.current,
          },
        )
        const adjustedData = applySubmitDataSideEffects(
          setSubmitDataFieldValue(
            nextData,
            fieldPath,
            result.fieldChange?.value !== undefined ? result.fieldChange.value : value,
          ),
          result.fieldChange?.sideEffects,
        )
        if (adjustedData !== nextData) {
          applySubmitDataToState(adjustedData)
        }
        const nextMessage = result.fieldChange?.messages?.find((message) => message.severity === 'error')?.text
        if (nextMessage) {
          setFieldErrors((current) => ({ ...current, [fieldPath]: nextMessage }))
        }
      } catch (error) {
        console.error('[PayPage] Error in onFieldChange:', error)
      }
    })()
  }, [applySubmitDataToState, triggerPayPageFormEvent])

  const updateCustomerField = React.useCallback((fieldKey: string, value: unknown) => {
    const fieldPath = `customerData.${fieldKey}`
    const nextData = setSubmitDataFieldValue(submitDataRef.current, fieldPath, value)
    applySubmitDataToState(nextData)
    clearFieldError(fieldPath)
    setSubmissionError(null)
    dispatchFieldChange(fieldPath, value, nextData)
  }, [applySubmitDataToState, clearFieldError, dispatchFieldChange])

  const updateConsent = React.useCallback((fieldKey: 'terms' | 'privacyPolicy', value: boolean) => {
    const fieldPath = `acceptedLegalConsents.${fieldKey}`
    const nextData = setSubmitDataFieldValue(submitDataRef.current, fieldPath, value)
    applySubmitDataToState(nextData)
    clearFieldError(fieldPath)
    setSubmissionError(null)
    dispatchFieldChange(fieldPath, value, nextData)
  }, [applySubmitDataToState, clearFieldError, dispatchFieldChange])

  const previewBanner = payload ? (
    isPreview ? (
      <div
        className="rounded-[28px] border px-5 py-4"
        style={{
          background: withAlpha(themeTokens.accentSecondary, 0.12),
          borderColor: withAlpha(themeTokens.accentSecondary, 0.44),
          color: themeTokens.text,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{t('checkout.payPage.previewBanner', 'Preview mode. Payments are disabled.')}</span>
          <Button asChild type="button" variant="outline" style={buildButtonStyle(themeTokens, 'outline')}>
            <Link href={mode === 'template'
              ? `/backend/checkout/templates/${encodeURIComponent(payload.id)}`
              : `/backend/checkout/pay-links/${encodeURIComponent(payload.id)}`}
            >
              {t('checkout.payPage.actions.backToAdmin', 'Back to admin')}
            </Link>
          </Button>
        </div>
      </div>
    ) : null
  ) : null

  const SurfaceComponent = useRegisteredComponent<PayPageSurfaceProps>(PAGE_HANDLE, PayPageSurface)
  const HeaderComponent = useRegisteredComponent<PayPageHeaderProps>(HEADER_HANDLE, PayPageHeader)
  const DescriptionComponent = useRegisteredComponent<PayPageDescriptionProps>(DESCRIPTION_HANDLE, PayPageDescription)
  const CustomerFormComponent = useRegisteredComponent<PayPageCustomerFormProps>(CUSTOMER_FORM_HANDLE, PayPageCustomerForm)
  const PricingComponent = useRegisteredComponent<PayPagePricingProps>(PRICING_HANDLE, PayPagePricing)
  const SummaryComponent = useRegisteredComponent<PayPageSummaryProps>(SUMMARY_HANDLE, PayPageSummary)
  const LegalConsentComponent = useRegisteredComponent<PayPageLegalConsentProps>(LEGAL_CONSENT_HANDLE, PayPageLegalConsent)
  const PaymentSectionComponent = useRegisteredComponent<PayPagePaymentSectionProps>(PAYMENT_HANDLE, PayPagePaymentSection)
  const PaymentFormComponent = useRegisteredComponent<PayPagePaymentFormProps>(GATEWAY_FORM_HANDLE, PayPagePaymentForm)
  const HelpComponent = useRegisteredComponent<PayPageHelpProps>(HELP_HANDLE, PayPageHelp)
  const FooterComponent = useRegisteredComponent<PayPageFooterProps>(FOOTER_HANDLE, PayPageFooter)

  const submitPayment = React.useCallback(async () => {
    if (isPreview || !payload) return
    const nextErrors = await transformValidationErrors(validateBeforeSubmit())
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      setSubmissionError(t('checkout.payPage.validation.fixErrors', 'Check the highlighted fields and try again.'))
      return
    }

    setIsSubmitting(true)
    setSubmissionError(null)
    setFieldErrors({})

    try {
      let nextSubmitData = submitDataRef.current
      if (injectionContextRef.current) {
        try {
          const transformed = await triggerPayPageFormEvent(
            'transformFormData',
            nextSubmitData,
            injectionContextRef.current,
          )
          if (transformed.data) {
            nextSubmitData = transformed.data
            if (transformed.applyToForm) {
              applySubmitDataToState(nextSubmitData)
            }
          }
        } catch (error) {
          console.error('[PayPage] Error in transformFormData:', error)
        }
      }

      let injectionRequestHeaders: Record<string, string> | undefined
      if (injectionContextRef.current) {
        const guard = await triggerPayPageFormEvent('onBeforeSave', nextSubmitData, injectionContextRef.current)
        if (!guard.ok) {
          const transformedErrors = await transformValidationErrors(guard.fieldErrors ?? {})
          if (Object.keys(transformedErrors).length > 0) {
            setFieldErrors(transformedErrors)
          }
          setSubmissionError(
            guard.message
            || t('checkout.payPage.validation.fixErrors', 'Check the highlighted fields and try again.'),
          )
          setIsSubmitting(false)
          return
        }
        injectionRequestHeaders = guard.requestHeaders
        await triggerPayPageFormEvent('onSave', nextSubmitData, injectionContextRef.current)
      }

      const runSubmit = async () => readApiResultOrThrow<SubmitResponse>(
        `/api/checkout/pay/${encodeURIComponent(slug)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
            'x-om-unauthorized-redirect': '0',
          },
          body: JSON.stringify(nextSubmitData),
        },
      )

      const result = injectionRequestHeaders && Object.keys(injectionRequestHeaders).length > 0
        ? await withScopedApiRequestHeaders(injectionRequestHeaders, runSubmit)
        : await runSubmit()

      setActiveTransactionId(result.transactionId)

      if (result.paymentSession?.type === 'embedded') {
        const nextRenderer = result.paymentSession.providerKey
          ? getPaymentGatewayRenderer(result.paymentSession.providerKey, result.paymentSession.rendererKey)
          : null

        if (nextRenderer) {
          setPaymentSession(result.paymentSession)
          if (injectionContextRef.current) {
            await triggerPayPageFormEvent('onAfterSave', nextSubmitData, injectionContextRef.current)
          }
          return
        }

        if (result.redirectUrl) {
          if (injectionContextRef.current) {
            await triggerPayPageFormEvent('onAfterSave', nextSubmitData, injectionContextRef.current)
          }
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
        if (injectionContextRef.current) {
          await triggerPayPageFormEvent('onAfterSave', nextSubmitData, injectionContextRef.current)
        }
        window.location.href = result.redirectUrl
        return
      }

      if (injectionContextRef.current) {
        await triggerPayPageFormEvent('onAfterSave', nextSubmitData, injectionContextRef.current)
      }
      router.push(`/pay/${encodeURIComponent(slug)}/success/${encodeURIComponent(result.transactionId)}`)
    } catch (error) {
      const normalized = mapCrudServerErrorToFormErrors(error)
      const nextFieldErrors = await transformValidationErrors(Object.fromEntries(
        Object.entries(normalized.fieldErrors ?? {}).map(([fieldPath, message]) => [
          fieldPath,
          translateValidationMessage(message, fieldPath),
        ]),
      ))
      if (Object.keys(nextFieldErrors).length > 0) {
        setFieldErrors(nextFieldErrors)
      }
      setSubmissionError(
        translateValidationMessage(normalized.message)
        || t('checkout.payPage.errors.submit', 'Unable to start the payment. Please try again.'),
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [
    acceptedLegalConsents,
    applySubmitDataToState,
    customerData,
    effectiveAmount,
    isPreview,
    payload,
    router,
    selectedPriceItemId,
    slug,
    t,
    transformValidationErrors,
    triggerPayPageFormEvent,
    translateValidationMessage,
    validateBeforeSubmit,
  ])

  if (!slug || isLoading) {
    return (
      <div
        className="mx-auto flex min-h-[50vh] max-w-4xl items-center justify-center gap-3 px-4 py-16 text-sm"
        style={{ color: themeTokens.mutedText }}
      >
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
      <div
        className="min-h-screen px-4 py-8 sm:px-6"
        style={{ background: themeTokens.pageBackground, color: themeTokens.text }}
      >
        <div className="mx-auto max-w-lg">
          <Card
            className="rounded-[32px] border backdrop-blur"
            style={buildPanelStyle(themeTokens, 'default')}
          >
            <CardContent className="space-y-5 p-6 sm:p-8">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: themeTokens.mutedText }}>
                  {t('checkout.payPage.badges.secure', 'Secure checkout')}
                </div>
                <h1 className="text-2xl font-semibold">{payload.title ?? t('checkout.payPage.protectedTitle', 'Protected payment link')}</h1>
              </div>
              <Input
                className={READABLE_INPUT_CLASSNAME}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('checkout.payPage.passwordPlaceholder', 'Password')}
                style={buildReadableInputStyle(themeTokens, Boolean(passwordError))}
              />
              {passwordError ? (
                <p className="text-sm" style={buildValidationMessageStyle(themeTokens)}>
                  {passwordError}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={isVerifyingPassword}
                style={buildButtonStyle(themeTokens)}
                onClick={async () => {
                  setIsVerifyingPassword(true)
                  setPasswordError(null)
                  try {
                    await apiCallOrThrow(`/api/checkout/pay/${encodeURIComponent(slug)}/verify-password`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-om-unauthorized-redirect': '0',
                      },
                      body: JSON.stringify({ password }),
                    })
                    await loadPayload()
                  } catch (error) {
                    setPasswordError(readTranslatedErrorMessage(
                      error,
                      t,
                      t('checkout.payPage.errors.password', 'Unable to verify password. Please try again.'),
                    ))
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
      </div>
    )
  }

  if (payload.available === false && !isPreview) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm" style={{ color: themeTokens.mutedText }}>
        {t('checkout.payPage.unavailable', 'This payment link is no longer available.')}
      </div>
    )
  }

  if (!injectionContext) return null

  const leftColumn = (
    <div className="space-y-6">
      <InjectionSpot spotId="checkout.pay-page:header:before" context={injectionContext} />
      <div data-component-handle={HEADER_HANDLE}>
        <HeaderComponent payload={payload} preview={isPreview} themeTokens={themeTokens} />
      </div>
      <InjectionSpot spotId="checkout.pay-page:header:after" context={injectionContext} />

      {(payload.description || publicCustomFields.length > 0) ? (
        <>
          <div data-component-handle={DESCRIPTION_HANDLE}>
            <DescriptionComponent
              payload={payload}
              publicCustomFields={publicCustomFields}
              themeTokens={themeTokens}
            />
          </div>
          <InjectionSpot spotId="checkout.pay-page:description:after" context={injectionContext} />
        </>
      ) : null}

      <InjectionSpot spotId="checkout.pay-page:customer-fields:before" context={injectionContext} />
      {shouldCollectCustomerDetails ? (
        <div data-component-handle={CUSTOMER_FORM_HANDLE}>
          <CustomerFormComponent
            payload={payload}
            customerData={customerData}
            fieldErrors={fieldErrors}
            inputsLocked={inputsLocked}
            onFieldChange={updateCustomerField}
            translateValidationMessage={translateValidationMessage}
            themeTokens={themeTokens}
          />
        </div>
      ) : null}
      <InjectionSpot spotId="checkout.pay-page:customer-fields:after" context={injectionContext} />
    </div>
  )

  const paymentFlow = (
    <>
      <InjectionSpot spotId="checkout.pay-page:pricing:before" context={injectionContext} />
      <div data-component-handle={PRICING_HANDLE}>
        <PricingComponent
          payload={payload}
          amount={amount}
          selectedPriceItemId={selectedPriceItemId}
          fieldErrors={fieldErrors}
          inputsLocked={inputsLocked}
          formatAmount={formatAmount}
          onAmountChange={(value) => {
            const nextAmount = parseNumericInput(value)
            const nextData = setSubmitDataFieldValue(submitDataRef.current, 'amount', nextAmount)
            applySubmitDataToState(nextData)
            clearFieldError('amount')
            setSubmissionError(null)
            dispatchFieldChange('amount', nextAmount, nextData)
          }}
          onPriceItemSelect={(item) => {
            const nextData = {
              ...submitDataRef.current,
              amount: item.amount,
              selectedPriceItemId: item.id,
            }
            applySubmitDataToState(nextData)
            clearFieldError('selectedPriceItemId')
            setSubmissionError(null)
            dispatchFieldChange('selectedPriceItemId', item.id, nextData)
          }}
          translateValidationMessage={translateValidationMessage}
          themeTokens={themeTokens}
        />
      </div>
      <InjectionSpot spotId="checkout.pay-page:pricing:after" context={injectionContext} />

      <InjectionSpot spotId="checkout.pay-page:summary:before" context={injectionContext} />
      <div data-component-handle={SUMMARY_HANDLE}>
        <SummaryComponent
          payload={payload}
          selectedAmount={effectiveAmount}
          currencyCode={effectiveCurrencyCode}
          formatAmount={formatAmount}
          preview={isPreview}
          themeTokens={themeTokens}
        />
      </div>
      <InjectionSpot spotId="checkout.pay-page:summary:after" context={injectionContext} />

      <InjectionSpot spotId="checkout.pay-page:legal-consent:before" context={injectionContext} />
      <div data-component-handle={LEGAL_CONSENT_HANDLE}>
        <LegalConsentComponent
          payload={payload}
          acceptedLegalConsents={acceptedLegalConsents}
          fieldErrors={fieldErrors}
          inputsLocked={inputsLocked}
          onConsentChange={updateConsent}
          translateValidationMessage={translateValidationMessage}
          themeTokens={themeTokens}
        />
      </div>
      <InjectionSpot spotId="checkout.pay-page:legal-consent:after" context={injectionContext} />

      <InjectionSpot spotId="checkout.pay-page:submit:before" context={injectionContext} />
      <div data-component-handle={GATEWAY_FORM_HANDLE}>
        <PaymentFormComponent
          payload={payload}
          slug={slug}
          preview={isPreview}
          isSubmitting={isSubmitting}
          submissionError={submissionError}
          paymentSession={paymentSession}
          activeTransactionId={activeTransactionId}
          embeddedRenderer={embeddedRenderer}
          onSubmit={submitPayment}
          onReset={() => {
            setPaymentSession(null)
            setActiveTransactionId(null)
            setSubmissionError(null)
          }}
          onComplete={() => {
            if (!activeTransactionId) return
            router.push(`/pay/${encodeURIComponent(slug)}/success/${encodeURIComponent(activeTransactionId)}`)
          }}
          onError={(message) => {
            setSubmissionError(message)
          }}
          injectionContext={injectionContext}
          themeTokens={themeTokens}
        />
      </div>
      <InjectionSpot spotId="checkout.pay-page:submit:after" context={injectionContext} />

      <InjectionSpot spotId="checkout.pay-page:help:before" context={injectionContext} />
      <div data-component-handle={HELP_HANDLE}>
        <HelpComponent payload={payload} preview={isPreview} themeTokens={themeTokens} />
      </div>
      <InjectionSpot spotId="checkout.pay-page:help:after" context={injectionContext} />
    </>
  )

  const rightColumn = (
    <>
      <InjectionSpot spotId="checkout.pay-page:payment:before" context={injectionContext} />
      <div data-component-handle={PAYMENT_HANDLE}>
        <PaymentSectionComponent payload={payload} preview={isPreview} themeTokens={themeTokens}>
          {paymentFlow}
        </PaymentSectionComponent>
      </div>
      <InjectionSpot spotId="checkout.pay-page:payment:after" context={injectionContext} />
    </>
  )

  const footer = (
    <>
      <InjectionSpot spotId="checkout.pay-page:footer:before" context={injectionContext} />
      <div data-component-handle={FOOTER_HANDLE}>
        <FooterComponent payload={payload} themeTokens={themeTokens} />
      </div>
      <InjectionSpot spotId="checkout.pay-page:footer:after" context={injectionContext} />
    </>
  )

  return (
    <div data-component-handle={PAGE_HANDLE}>
      <SurfaceComponent
        previewBanner={previewBanner}
        leftColumn={leftColumn}
        rightColumn={rightColumn}
        footer={footer}
        themeTokens={themeTokens}
      />
    </div>
  )
}

export default PayPage
