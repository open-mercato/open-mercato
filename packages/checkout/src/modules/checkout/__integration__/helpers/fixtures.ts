import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import type { PublicSubmitInput } from '../../data/validators'

type JsonRecord = Record<string, unknown>

let forwardedIpSequence = Math.floor(Math.random() * 10_000)

export type CheckoutTemplateInput = {
  name: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  pricingMode: 'fixed' | 'custom_amount' | 'price_list'
  fixedPriceAmount?: number | null
  fixedPriceCurrencyCode?: string | null
  fixedPriceIncludesTax?: boolean
  fixedPriceOriginalAmount?: number | null
  customAmountMin?: number | null
  customAmountMax?: number | null
  customAmountCurrencyCode?: string | null
  priceListItems?: Array<{
    id: string
    description: string
    amount: number
    currencyCode: string
  }> | null
  gatewayProviderKey: string
  gatewaySettings?: Record<string, unknown>
  customFieldsetCode?: string | null
  collectCustomerDetails?: boolean
  legalDocuments?: {
    terms?: { title: string; markdown: string; required?: boolean }
    privacyPolicy?: { title: string; markdown: string; required?: boolean }
  }
  displayCustomFieldsOnPage?: boolean
  password?: string | null
  maxCompletions?: number | null
  status?: 'draft' | 'active' | 'inactive'
  customFields?: Record<string, unknown>
}

export type CheckoutLinkInput = CheckoutTemplateInput & {
  templateId?: string | null
  slug?: string | null
}

export type CheckoutLinkRecord = {
  id: string
  slug: string
  name?: string
  title?: string | null
  subtitle?: string | null
  status?: string
  templateId?: string | null
  completionCount?: number
  activeReservationCount?: number
  fixedPriceAmount?: number | null
  displayCustomFieldsOnPage?: boolean
  publicCustomFields?: Array<{ key?: string; label?: string; value?: unknown }>
  customerFieldsSchema?: Array<{ key: string; required?: boolean }>
  requiresPassword?: boolean
  available?: boolean
  remainingUses?: number | null
  gatewayProviderKey?: string | null
  customFields?: Record<string, unknown>
}

export type CheckoutTransactionRecord = {
  id: string
  linkId?: string
  status: string
  paymentStatus?: string | null
  gatewayTransactionId?: string | null
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  acceptedLegalConsents?: Record<string, unknown> | null
  customerData?: Record<string, unknown> | null
}

export type ExampleCapturedEvent = {
  event: string
  payload: Record<string, unknown>
  capturedAt: string
}

function uniqueLabel(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createUniqueForwardedIp(): string {
  forwardedIpSequence += 1
  const thirdOctet = Math.floor(forwardedIpSequence / 250) % 250 + 1
  const fourthOctet = forwardedIpSequence % 250 + 1
  return `198.51.${thirdOctet}.${fourthOctet}`
}

export function createCheckoutClientHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  if (overrides['x-forwarded-for'] || overrides['x-real-ip']) {
    return overrides
  }
  return {
    'x-forwarded-for': createUniqueForwardedIp(),
    ...overrides,
  }
}

export function createFixedTemplateInput(overrides: Partial<CheckoutLinkInput> = {}): CheckoutLinkInput {
  const label = uniqueLabel('checkout-fixed')
  return {
    name: `QA ${label}`,
    title: `QA ${label}`,
    subtitle: 'QA checkout fixture',
    description: 'QA checkout fixture description',
    pricingMode: 'fixed',
    fixedPriceAmount: 49.99,
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: 69.99,
    gatewayProviderKey: 'mock',
    status: 'draft',
    collectCustomerDetails: true,
    displayCustomFieldsOnPage: false,
    ...overrides,
  }
}

export function createCustomAmountTemplateInput(overrides: Partial<CheckoutLinkInput> = {}): CheckoutLinkInput {
  const label = uniqueLabel('checkout-custom')
  return {
    name: `QA ${label}`,
    title: `QA ${label}`,
    subtitle: 'QA custom amount fixture',
    description: 'QA custom amount description',
    pricingMode: 'custom_amount',
    customAmountMin: 10,
    customAmountMax: 100,
    customAmountCurrencyCode: 'USD',
    gatewayProviderKey: 'mock',
    status: 'active',
    collectCustomerDetails: true,
    displayCustomFieldsOnPage: false,
    ...overrides,
  }
}

export function createPriceListTemplateInput(overrides: Partial<CheckoutLinkInput> = {}): CheckoutLinkInput {
  const label = uniqueLabel('checkout-price-list')
  return {
    name: `QA ${label}`,
    title: `QA ${label}`,
    subtitle: 'QA price list fixture',
    description: 'QA price list description',
    pricingMode: 'price_list',
    priceListItems: [
      { id: 'basic', description: 'Basic', amount: 19.99, currencyCode: 'USD' },
      { id: 'plus', description: 'Plus', amount: 49.99, currencyCode: 'USD' },
    ],
    gatewayProviderKey: 'mock',
    status: 'active',
    collectCustomerDetails: true,
    displayCustomFieldsOnPage: false,
    ...overrides,
  }
}

export function createCustomerData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const label = uniqueLabel('customer')
  return {
    firstName: 'Quinn',
    lastName: 'Checkout',
    email: `${label}@example.test`,
    phone: '+15550001111',
    ...overrides,
  }
}

export async function createTemplateFixture(
  request: APIRequestContext,
  token: string,
  input: CheckoutTemplateInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/checkout/templates', {
    token,
    data: input,
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `Failed to create template: ${response.status()}`).toBeTruthy()
  expect(typeof body?.id === 'string' && body.id.length > 0, 'Template id is required').toBeTruthy()
  return body!.id!
}

export async function createLinkFixture(
  request: APIRequestContext,
  token: string,
  input: CheckoutLinkInput,
): Promise<{ id: string; slug: string }> {
  const response = await apiRequest(request, 'POST', '/api/checkout/links', {
    token,
    data: input,
  })
  const body = await readJsonSafe<{ id?: string; slug?: string }>(response)
  expect(response.ok(), `Failed to create link: ${response.status()}`).toBeTruthy()
  expect(typeof body?.id === 'string' && body.id.length > 0, 'Link id is required').toBeTruthy()
  expect(typeof body?.slug === 'string' && body.slug.length > 0, 'Link slug is required').toBeTruthy()
  return { id: body!.id!, slug: body!.slug! }
}

export async function readTemplate(
  request: APIRequestContext,
  token: string,
  templateId: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/checkout/templates/${encodeURIComponent(templateId)}`, { token })
  expect(response.ok(), `Failed to read template ${templateId}: ${response.status()}`).toBeTruthy()
  return (await readJsonSafe<JsonRecord>(response)) ?? {}
}

export async function readLink(
  request: APIRequestContext,
  token: string,
  linkId: string,
): Promise<CheckoutLinkRecord> {
  const response = await apiRequest(request, 'GET', `/api/checkout/links/${encodeURIComponent(linkId)}`, { token })
  expect(response.ok(), `Failed to read link ${linkId}: ${response.status()}`).toBeTruthy()
  return ((await readJsonSafe<CheckoutLinkRecord>(response)) ?? {}) as CheckoutLinkRecord
}

export async function updateTemplate(
  request: APIRequestContext,
  token: string,
  templateId: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', `/api/checkout/templates/${encodeURIComponent(templateId)}`, {
    token,
    data,
  })
}

export async function updateLink(
  request: APIRequestContext,
  token: string,
  linkId: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', `/api/checkout/links/${encodeURIComponent(linkId)}`, {
    token,
    data,
  })
}

export async function deleteTemplate(
  request: APIRequestContext,
  token: string,
  templateId: string,
): Promise<APIResponse> {
  return apiRequest(request, 'DELETE', `/api/checkout/templates/${encodeURIComponent(templateId)}`, { token })
}

export async function deleteLink(
  request: APIRequestContext,
  token: string,
  linkId: string,
): Promise<APIResponse> {
  return apiRequest(request, 'DELETE', `/api/checkout/links/${encodeURIComponent(linkId)}`, { token })
}

export async function listTemplates(
  request: APIRequestContext,
  token: string,
  query = '',
): Promise<{ items: JsonRecord[]; total: number }> {
  const response = await apiRequest(request, 'GET', `/api/checkout/templates${query ? `?${query}` : ''}`, { token })
  expect(response.ok(), `Failed to list templates: ${response.status()}`).toBeTruthy()
  return ((await readJsonSafe<{ items?: JsonRecord[]; total?: number }>(response)) ?? {
    items: [],
    total: 0,
  }) as { items: JsonRecord[]; total: number }
}

export async function listLinks(
  request: APIRequestContext,
  token: string,
  query = '',
): Promise<{ items: JsonRecord[]; total: number }> {
  const response = await apiRequest(request, 'GET', `/api/checkout/links${query ? `?${query}` : ''}`, { token })
  expect(response.ok(), `Failed to list links: ${response.status()}`).toBeTruthy()
  return ((await readJsonSafe<{ items?: JsonRecord[]; total?: number }>(response)) ?? {
    items: [],
    total: 0,
  }) as { items: JsonRecord[]; total: number }
}

export async function readPublicPayLink(
  request: APIRequestContext,
  slug: string,
  options?: { headers?: Record<string, string>; preview?: boolean },
): Promise<APIResponse> {
  const query = options?.preview ? '?preview=true' : ''
  return request.fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/checkout/pay/${encodeURIComponent(slug)}${query}`, {
    method: 'GET',
    headers: createCheckoutClientHeaders(options?.headers),
  })
}

export async function verifyPayLinkPassword(
  request: APIRequestContext,
  slug: string,
  password: string,
): Promise<APIResponse> {
  return request.fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/checkout/pay/${encodeURIComponent(slug)}/verify-password`, {
    method: 'POST',
    headers: createCheckoutClientHeaders({ 'Content-Type': 'application/json' }),
    data: { password },
  })
}

export async function submitPayLink(
  request: APIRequestContext,
  slug: string,
  input: PublicSubmitInput,
  options?: { idempotencyKey?: string; headers?: Record<string, string> },
): Promise<APIResponse> {
  return request.fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/checkout/pay/${encodeURIComponent(slug)}/submit`, {
    method: 'POST',
    headers: createCheckoutClientHeaders({
      'Content-Type': 'application/json',
      'Idempotency-Key': options?.idempotencyKey ?? uniqueLabel('idempotency'),
      ...(options?.headers ?? {}),
    }),
    data: input,
  })
}

export async function readCheckoutTransaction(
  request: APIRequestContext,
  token: string,
  transactionId: string,
): Promise<CheckoutTransactionRecord> {
  const response = await apiRequest(request, 'GET', `/api/checkout/transactions/${encodeURIComponent(transactionId)}`, { token })
  expect(response.ok(), `Failed to read transaction ${transactionId}: ${response.status()}`).toBeTruthy()
  const body = (await readJsonSafe<{ transaction?: CheckoutTransactionRecord }>(response)) ?? {}
  return (body.transaction ?? {}) as CheckoutTransactionRecord
}

export async function listCheckoutTransactions(
  request: APIRequestContext,
  token: string,
  query = '',
): Promise<{ items: CheckoutTransactionRecord[]; total: number; canViewPii?: boolean }> {
  const response = await apiRequest(request, 'GET', `/api/checkout/transactions${query ? `?${query}` : ''}`, { token })
  expect(response.ok(), `Failed to list checkout transactions: ${response.status()}`).toBeTruthy()
  return ((await readJsonSafe<{ items?: CheckoutTransactionRecord[]; total?: number; canViewPii?: boolean }>(response)) ?? {
    items: [],
    total: 0,
  }) as { items: CheckoutTransactionRecord[]; total: number; canViewPii?: boolean }
}

export async function readCheckoutStatus(
  request: APIRequestContext,
  slug: string,
  transactionId: string,
  options?: { headers?: Record<string, string> },
): Promise<APIResponse> {
  return request.fetch(
    `${process.env.BASE_URL || 'http://localhost:3000'}/api/checkout/pay/${encodeURIComponent(slug)}/status/${encodeURIComponent(transactionId)}`,
    {
      method: 'GET',
      headers: createCheckoutClientHeaders(options?.headers),
    },
  )
}

export async function waitForCheckoutStatus(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  expectedStatus: string,
): Promise<CheckoutTransactionRecord> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const transaction = await readCheckoutTransaction(request, token, transactionId)
    if (transaction.status === expectedStatus) return transaction
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return readCheckoutTransaction(request, token, transactionId)
}

export async function findGatewayTransactionIdForCheckout(
  request: APIRequestContext,
  token: string,
  checkoutTransactionId: string,
): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?page=1&pageSize=100', { token })
  expect(response.ok(), `Failed to list gateway transactions: ${response.status()}`).toBeTruthy()
  const body = (await readJsonSafe<{ items?: Array<{ id: string; paymentId: string }> }>(response)) ?? {}
  const match = body.items?.find((item) => item.paymentId === checkoutTransactionId)
  expect(match, `Gateway transaction for checkout ${checkoutTransactionId} was not found`).toBeTruthy()
  return match!.id
}

export async function readGatewayTransaction(
  request: APIRequestContext,
  token: string,
  gatewayTransactionId: string,
): Promise<{
  id: string
  providerSessionId: string | null
  unifiedStatus: string
}> {
  const response = await apiRequest(request, 'GET', `/api/payment_gateways/transactions/${encodeURIComponent(gatewayTransactionId)}`, { token })
  expect(response.ok(), `Failed to read gateway transaction ${gatewayTransactionId}: ${response.status()}`).toBeTruthy()
  const body = (await readJsonSafe<{ transaction?: { id: string; providerSessionId?: string | null; unifiedStatus?: string } }>(response)) ?? {}
  const transaction = body.transaction
  expect(transaction?.id, 'Gateway transaction payload is required').toBeTruthy()
  return {
    id: transaction!.id,
    providerSessionId: transaction?.providerSessionId ?? null,
    unifiedStatus: transaction?.unifiedStatus ?? 'unknown',
  }
}

export async function sendMockGatewayWebhook(
  request: APIRequestContext,
  token: string,
  providerSessionId: string,
  status: 'captured' | 'cancelled' | 'failed',
  amount: number,
  options?: { providerKey?: string },
): Promise<APIResponse> {
  return apiRequest(request, 'POST', `/api/payment_gateways/webhook/${encodeURIComponent(options?.providerKey ?? 'mock')}`, {
    token,
    data: {
      type: `payment.${status}`,
      id: uniqueLabel(`mock-${status}`),
      data: {
        id: providerSessionId,
        status,
        amount,
      },
    },
  })
}

export async function deleteCheckoutEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  kind: 'templates' | 'links',
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `/api/checkout/${kind}/${encodeURIComponent(id)}`, { token })
  } catch {
    return
  }
}

export async function loginToBackendAndOpen(page: Page, path: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@acme.com')
  await page.getByLabel('Password').fill('secret')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/backend(?:\/.*)?$/)
  await page.goto(path)
}

export async function clearCapturedExampleEvents(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const response = await apiRequest(request, 'DELETE', '/api/example/qa-events', { token })
  expect(response.ok(), `Failed to clear captured example events: ${response.status()}`).toBeTruthy()
}

export async function listCapturedExampleEvents(
  request: APIRequestContext,
  token: string,
  options?: { event?: string; prefix?: string },
): Promise<ExampleCapturedEvent[]> {
  const query = new URLSearchParams()
  if (options?.event) query.set('event', options.event)
  if (options?.prefix) query.set('prefix', options.prefix)
  const response = await apiRequest(request, 'GET', `/api/example/qa-events${query.size > 0 ? `?${query.toString()}` : ''}`, {
    token,
  })
  expect(response.ok(), `Failed to list captured example events: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: ExampleCapturedEvent[] }>(response)
  return Array.isArray(body?.items) ? body.items : []
}

export async function waitForCapturedExampleEvents(
  request: APIRequestContext,
  token: string,
  expectedEventNames: string[],
): Promise<ExampleCapturedEvent[]> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await listCapturedExampleEvents(request, token)
    const seenNames = new Set(events.map((event) => event.event))
    if (expectedEventNames.every((eventName) => seenNames.has(eventName))) {
      return events
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return listCapturedExampleEvents(request, token)
}
