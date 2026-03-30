import { createHmac, timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { slugify } from '@open-mercato/shared/lib/slugify'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getPaymentGatewayDescriptor } from '@open-mercato/shared/modules/payment_gateways/types'
import { CheckoutLink, CheckoutLinkTemplate, CheckoutTransaction } from '../data/entities'
import { buildCheckoutAttachmentPreviewUrl, normalizeOptionalString } from './client-utils'
import type {
  CreateLinkInput,
  CreateTemplateInput,
  PublicSubmitInput,
  UpdateLinkInput,
  UpdateTemplateInput,
} from '../data/validators'
import { CHECKOUT_TERMINAL_STATUSES } from './constants'
export {
  getCheckoutCustomerFieldSemanticType,
  isValidCheckoutEmail,
  isValidCheckoutPhone,
  validateCheckoutCustomerData,
} from './customerDataValidation'

export type CheckoutScope = {
  organizationId: string
  tenantId: string
}

export type CheckoutLinkStatus = 'draft' | 'active' | 'inactive'

export type CheckoutPayloadWithCustomFields<TInput> = {
  parsed: TInput
  customFields: Record<string, unknown>
}

type TemplateOrLinkInput =
  | CreateTemplateInput
  | UpdateTemplateInput
  | CreateLinkInput
  | UpdateLinkInput

type TemplateOrLinkMutationInput = Omit<CreateLinkInput, 'password'> & {
  password?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCheckoutLinkRecord(record: CheckoutLinkTemplate | CheckoutLink): record is CheckoutLink {
  return typeof (record as { slug?: unknown }).slug === 'string'
}

export function pickExplicitParsedOverrides<TInput extends Record<string, unknown>>(
  rawInput: unknown,
  parsed: TInput,
): Partial<TInput> {
  if (!isRecord(rawInput)) return {}

  const overrides: Partial<TInput> = {}
  for (const key of Object.keys(parsed) as Array<keyof TInput>) {
    if (!Object.prototype.hasOwnProperty.call(rawInput, key)) continue
    overrides[key] = parsed[key]
  }

  return overrides
}

export function requireCheckoutScope(input: { auth?: { orgId?: string | null; tenantId?: string | null } | null }): CheckoutScope {
  const organizationId = input.auth?.orgId ?? null
  const tenantId = input.auth?.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  return { organizationId, tenantId }
}

export function parseCheckoutInput<TInput>(raw: unknown, parser: (value: unknown) => TInput): CheckoutPayloadWithCustomFields<TInput> {
  const source = isRecord(raw) ? { ...raw } : {}
  const customFields = isRecord(source.customFields) ? source.customFields : {}
  delete source.customFields
  return {
    parsed: parser(source),
    customFields,
  }
}

export function resolveLoadedCheckoutCustomFields(
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return normalizeCustomFieldResponse(values) ?? {}
}

export function toIsoString(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function toMoneyNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function toMoneyString(value: string | number | null | undefined): string | null {
  const numeric = toMoneyNumber(value)
  return numeric == null ? null : numeric.toFixed(2)
}

export { normalizeOptionalString, buildCheckoutAttachmentPreviewUrl } from './client-utils'

export function deriveConfiguredCurrencies(input: TemplateOrLinkInput): string[] {
  const currencies = new Set<string>()
  if (input.pricingMode === 'fixed' && input.fixedPriceCurrencyCode) currencies.add(input.fixedPriceCurrencyCode)
  if (input.pricingMode === 'custom_amount' && input.customAmountCurrencyCode) currencies.add(input.customAmountCurrencyCode)
  if (input.pricingMode === 'price_list') {
    for (const item of input.priceListItems ?? []) currencies.add(item.currencyCode)
  }
  return Array.from(currencies)
}

export function toTemplateOrLinkMutationInput(
  record: CheckoutLinkTemplate | CheckoutLink,
  overrides: Partial<TemplateOrLinkMutationInput> = {},
): TemplateOrLinkMutationInput {
  return {
    name: record.name,
    title: record.title ?? null,
    subtitle: record.subtitle ?? null,
    description: record.description ?? null,
    logoAttachmentId: record.logoAttachmentId ?? null,
    logoUrl: record.logoUrl ?? null,
    primaryColor: record.primaryColor ?? null,
    secondaryColor: record.secondaryColor ?? null,
    backgroundColor: record.backgroundColor ?? null,
    themeMode: record.themeMode,
    pricingMode: record.pricingMode,
    fixedPriceAmount: toMoneyNumber(record.fixedPriceAmount),
    fixedPriceCurrencyCode: record.fixedPriceCurrencyCode ?? null,
    fixedPriceIncludesTax: record.fixedPriceIncludesTax,
    fixedPriceOriginalAmount: toMoneyNumber(record.fixedPriceOriginalAmount),
    customAmountMin: toMoneyNumber(record.customAmountMin),
    customAmountMax: toMoneyNumber(record.customAmountMax),
    customAmountCurrencyCode: record.customAmountCurrencyCode ?? null,
    priceListItems: record.priceListItems ?? null,
    gatewayProviderKey: record.gatewayProviderKey ?? '',
    gatewaySettings: record.gatewaySettings ?? {},
    customFieldsetCode: record.customFieldsetCode ?? null,
    collectCustomerDetails: record.collectCustomerDetails,
    customerFieldsSchema: (record.customerFieldsSchema ?? []) as CreateTemplateInput['customerFieldsSchema'],
    legalDocuments: (record.legalDocuments ?? undefined) as CreateTemplateInput['legalDocuments'],
    displayCustomFieldsOnPage: record.displayCustomFieldsOnPage,
    successTitle: record.successTitle ?? null,
    successMessage: record.successMessage ?? null,
    cancelTitle: record.cancelTitle ?? null,
    cancelMessage: record.cancelMessage ?? null,
    errorTitle: record.errorTitle ?? null,
    errorMessage: record.errorMessage ?? null,
    successEmailSubject: record.successEmailSubject ?? null,
    successEmailBody: record.successEmailBody ?? null,
    sendSuccessEmail: record.sendSuccessEmail,
    errorEmailSubject: record.errorEmailSubject ?? null,
    errorEmailBody: record.errorEmailBody ?? null,
    sendErrorEmail: record.sendErrorEmail,
    startEmailSubject: record.startEmailSubject ?? null,
    startEmailBody: record.startEmailBody ?? null,
    sendStartEmail: record.sendStartEmail,
    password: undefined,
    maxCompletions: record.maxCompletions ?? null,
    status: record.status,
    checkoutType: record.checkoutType,
    ...(isCheckoutLinkRecord(record) ? { slug: record.slug, templateId: record.templateId ?? null } : {}),
    ...overrides,
  }
}

export function validateDescriptorCurrencies(providerKey: string | null | undefined, currencies: string[]): void {
  if (!providerKey || currencies.length === 0) return
  const descriptor = getPaymentGatewayDescriptor(providerKey)
  const supported = descriptor?.sessionConfig?.supportedCurrencies
  if (!descriptor || !supported || supported === '*') return
  const unsupported = currencies.filter((currency) => !supported.includes(currency))
  if (unsupported.length > 0) {
    throw new CrudHttpError(422, {
      error: `Unsupported currency for provider ${providerKey}: ${unsupported.join(', ')}`,
    })
  }
}

export async function ensureUniqueSlug(
  em: EntityManager,
  _scope: CheckoutScope,
  requestedSlug: string | null | undefined,
  fallbackText: string,
  excludeId?: string | null,
): Promise<string> {
  const base = slugify(requestedSlug || fallbackText || 'pay-link') || 'pay-link'
  let candidate = base
  let counter = 1
  while (true) {
    const existing = await em.findOne(CheckoutLink, {
      slug: candidate,
      deletedAt: null,
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    })
    if (!existing) return candidate
    counter += 1
    candidate = `${base}-${counter}`
  }
}

export async function hashCheckoutPassword(password: string | null | undefined): Promise<string | null> {
  const normalized = normalizeOptionalString(password)
  if (!normalized) return null
  return bcrypt.hash(normalized, 10)
}

export async function verifyCheckoutPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) return false
  return bcrypt.compare(password, passwordHash)
}

function getCheckoutAccessTokenSecret(): string {
  const secret = process.env.AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.JWT_SECRET
    || process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  if (!secret) {
    throw new Error(
      'Checkout password sessions require AUTH_SECRET, NEXTAUTH_SECRET, JWT_SECRET, or TENANT_DATA_ENCRYPTION_FALLBACK_KEY',
    )
  }
  return secret
}

function normalizeCheckoutAccessSessionVersion(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export function signCheckoutAccessToken(
  slug: string,
  options?: { linkId?: string | null; sessionVersion?: Date | string | null },
): string {
  const payload = Buffer.from(JSON.stringify({
    slug,
    linkId: options?.linkId ?? null,
    sessionVersion: normalizeCheckoutAccessSessionVersion(options?.sessionVersion),
    exp: Date.now() + (60 * 60 * 1000),
  }), 'utf-8').toString('base64url')
  const signature = createHmac('sha256', getCheckoutAccessTokenSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyCheckoutAccessToken(
  token: string | null | undefined,
  slug: string,
  options?: { linkId?: string | null; sessionVersion?: Date | string | null },
): boolean {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false
  const expected = createHmac('sha256', getCheckoutAccessTokenSecret()).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      slug?: string
      linkId?: string | null
      sessionVersion?: string | null
      exp?: number
    }
    if (parsed.slug !== slug || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return false
    if (options?.linkId && parsed.linkId !== options.linkId) return false
    if (options?.sessionVersion) {
      return parsed.sessionVersion === normalizeCheckoutAccessSessionVersion(options.sessionVersion)
    }
    return true
  } catch {
    return false
  }
}

export function mapGatewayStatusToCheckoutStatus(status: string | null | undefined): CheckoutTransaction['status'] {
  if (status === 'captured' || status === 'authorized') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'expired') return 'expired'
  if (status === 'failed') return 'failed'
  return 'processing'
}

export function isTerminalCheckoutStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && CHECKOUT_TERMINAL_STATUSES.has(status)
}

export function isCheckoutLinkPublic(status: CheckoutLinkStatus | string | null | undefined): boolean {
  return status === 'active'
}

export function applyTerminalTransactionState(
  link: Pick<CheckoutLink, 'activeReservationCount' | 'completionCount' | 'isLocked' | 'maxCompletions'>,
  status: CheckoutTransaction['status'],
): { usageLimitReached: boolean } {
  link.activeReservationCount = Math.max(0, link.activeReservationCount - 1)
  if (status === 'completed') {
    link.completionCount += 1
  }
  link.isLocked = link.activeReservationCount > 0
  return {
    usageLimitReached: status === 'completed'
      && link.maxCompletions != null
      && link.completionCount >= link.maxCompletions,
  }
}

export function buildConsentProof(link: CheckoutLink, acceptedLegalConsents: PublicSubmitInput['acceptedLegalConsents']) {
  const proof: Record<string, unknown> = {}
  const legalDocuments = link.legalDocuments && typeof link.legalDocuments === 'object'
    ? link.legalDocuments as Record<string, { title?: string; markdown?: string; required?: boolean }>
    : {}
  for (const key of ['terms', 'privacyPolicy']) {
    const document = legalDocuments[key]
    if (!document?.markdown) continue
    const accepted = acceptedLegalConsents?.[key as keyof PublicSubmitInput['acceptedLegalConsents']] === true
    if (!accepted) continue
    proof[key] = {
      title: document.title ?? key,
      required: document.required === true,
      acceptedAt: new Date().toISOString(),
      markdownHash: createHmac('sha256', key).update(document.markdown).digest('hex'),
    }
  }
  return proof
}

export function resolveSubmittedAmount(link: CheckoutLink, input: PublicSubmitInput): { amount: number; currencyCode: string; selectedPriceItemId: string | null } {
  if (link.pricingMode === 'fixed') {
    const expected = toMoneyNumber(link.fixedPriceAmount)
    if (expected == null || !link.fixedPriceCurrencyCode) {
      throw new CrudHttpError(422, { error: 'checkout.payPage.errors.submit' })
    }
    if (input.amount != null && Number(input.amount) !== expected) {
      throw new CrudHttpError(422, { error: 'checkout.payPage.errors.submit' })
    }
    return { amount: expected, currencyCode: link.fixedPriceCurrencyCode, selectedPriceItemId: null }
  }
  if (link.pricingMode === 'custom_amount') {
    if (input.amount == null || !link.customAmountCurrencyCode) {
      throw new CrudHttpError(422, {
        error: 'checkout.payPage.validation.fixErrors',
        fieldErrors: { amount: 'checkout.payPage.validation.amountRequired' },
      })
    }
    const min = toMoneyNumber(link.customAmountMin) ?? 0
    const max = toMoneyNumber(link.customAmountMax)
    const amount = Number(input.amount)
    if (amount < min || (max != null && amount > max)) {
      throw new CrudHttpError(422, {
        error: 'checkout.payPage.validation.fixErrors',
        fieldErrors: { amount: 'checkout.payPage.errors.submit' },
      })
    }
    return { amount, currencyCode: link.customAmountCurrencyCode, selectedPriceItemId: null }
  }
  const selectedPriceItem = (link.priceListItems ?? []).find((item) => item.id === input.selectedPriceItemId)
  if (!selectedPriceItem) {
    throw new CrudHttpError(422, {
      error: 'checkout.payPage.validation.fixErrors',
      fieldErrors: { selectedPriceItemId: 'checkout.payPage.validation.priceSelectionRequired' },
    })
  }
  if (input.amount != null && Number(input.amount) !== Number(selectedPriceItem.amount)) {
    throw new CrudHttpError(422, { error: 'checkout.payPage.errors.submit' })
  }
  return {
    amount: Number(selectedPriceItem.amount),
    currencyCode: selectedPriceItem.currencyCode,
    selectedPriceItemId: selectedPriceItem.id,
  }
}

export function serializeTemplateOrLink(record: CheckoutLinkTemplate | CheckoutLink) {
  const logoPreviewUrl = buildCheckoutAttachmentPreviewUrl(record.logoAttachmentId) ?? record.logoUrl ?? null
  return {
    id: record.id,
    name: record.name,
    title: record.title ?? null,
    subtitle: record.subtitle ?? null,
    description: record.description ?? null,
    logoAttachmentId: record.logoAttachmentId ?? null,
    logoUrl: record.logoUrl ?? null,
    logoPreviewUrl,
    primaryColor: record.primaryColor ?? null,
    secondaryColor: record.secondaryColor ?? null,
    backgroundColor: record.backgroundColor ?? null,
    themeMode: record.themeMode,
    pricingMode: record.pricingMode,
    fixedPriceAmount: toMoneyNumber(record.fixedPriceAmount),
    fixedPriceCurrencyCode: record.fixedPriceCurrencyCode ?? null,
    fixedPriceIncludesTax: record.fixedPriceIncludesTax,
    fixedPriceOriginalAmount: toMoneyNumber(record.fixedPriceOriginalAmount),
    customAmountMin: toMoneyNumber(record.customAmountMin),
    customAmountMax: toMoneyNumber(record.customAmountMax),
    customAmountCurrencyCode: record.customAmountCurrencyCode ?? null,
    priceListItems: record.priceListItems ?? [],
    gatewayProviderKey: record.gatewayProviderKey ?? null,
    gatewaySettings: record.gatewaySettings ?? {},
    customFieldsetCode: record.customFieldsetCode ?? null,
    collectCustomerDetails: record.collectCustomerDetails,
    customerFieldsSchema: record.customerFieldsSchema ?? [],
    legalDocuments: record.legalDocuments ?? {},
    displayCustomFieldsOnPage: record.displayCustomFieldsOnPage,
    successTitle: record.successTitle ?? null,
    successMessage: record.successMessage ?? null,
    cancelTitle: record.cancelTitle ?? null,
    cancelMessage: record.cancelMessage ?? null,
    errorTitle: record.errorTitle ?? null,
    errorMessage: record.errorMessage ?? null,
    successEmailSubject: record.successEmailSubject ?? null,
    successEmailBody: record.successEmailBody ?? null,
    sendSuccessEmail: record.sendSuccessEmail,
    errorEmailSubject: record.errorEmailSubject ?? null,
    errorEmailBody: record.errorEmailBody ?? null,
    sendErrorEmail: record.sendErrorEmail,
    startEmailSubject: record.startEmailSubject ?? null,
    startEmailBody: record.startEmailBody ?? null,
    sendStartEmail: record.sendStartEmail,
    maxCompletions: record.maxCompletions ?? null,
    status: record.status,
    checkoutType: record.checkoutType,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
    ...(isCheckoutLinkRecord(record) ? {
      slug: record.slug,
      templateId: record.templateId ?? null,
      completionCount: record.completionCount,
      activeReservationCount: record.activeReservationCount,
      isLocked: record.isLocked,
    } : {}),
  }
}

export function serializeTransaction(record: CheckoutTransaction, link?: CheckoutLink | null, includePii = false) {
  return {
    id: record.id,
    linkId: record.linkId,
    linkName: link?.name ?? null,
    linkSlug: link?.slug ?? null,
    amount: toMoneyNumber(record.amount),
    currencyCode: record.currencyCode,
    status: record.status,
    paymentStatus: record.paymentStatus ?? null,
    gatewayTransactionId: record.gatewayTransactionId ?? null,
    selectedPriceItemId: record.selectedPriceItemId ?? null,
    acceptedLegalConsents: includePii ? (record.acceptedLegalConsents ?? {}) : null,
    customerData: includePii ? (record.customerData ?? {}) : null,
    firstName: includePii ? (record.firstName ?? null) : null,
    lastName: includePii ? (record.lastName ?? null) : null,
    email: includePii ? (record.email ?? null) : null,
    phone: includePii ? (record.phone ?? null) : null,
    ipAddress: includePii ? (record.ipAddress ?? null) : null,
    userAgent: includePii ? (record.userAgent ?? null) : null,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  }
}
