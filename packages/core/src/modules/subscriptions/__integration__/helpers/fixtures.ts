import { createHmac } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  createRoleFixture,
  deleteRoleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const execFileAsync = promisify(execFile)

const BASE_URL = process.env.BASE_URL?.trim() || ''
const STRIPE_TEST_WEBHOOK_SECRET = 'whsec_open_mercato_integration'

export const PRODUCT_CODE = 'external-app'
export const STARTER_PRICE_CODE = 'starter-monthly-v1'
export const SUBJECT_ENTITY_TYPE = 'customers:customer_company'

export type AccessState = 'pending' | 'granted' | 'grace' | 'blocked'

export type AccessSnapshot = {
  subscriptionId: string | null
  externalAccountId: string
  productCode: string
  planCode: string | null
  priceCode: string | null
  provider: string | null
  providerStatus: string | null
  accessState: AccessState
  cancelAtPeriodEnd: boolean
  entitlements: Record<string, unknown> | null
}

export type CheckoutFixture = {
  checkoutUrl: string
  provider: 'stripe'
  subscriptionRequestId: string
  providerSessionId: string
  providerSubscriptionId: string
  providerCustomerId: string
}

export type ActivatedSubscriptionFixture = CheckoutFixture & {
  token: string
  tenantId: string
  organizationId: string
  companyId: string
  subjectEntityId: string
  externalAccountId: string
  subscriptionId: string
}

export type SubscriptionListItem = {
  id: string
  externalAccountId: string
  planCode: string | null
  priceCode: string | null
  productCode: string | null
  provider: string
  providerStatus: string
  providerSubscriptionId: string | null
  accessState: AccessState
  cancelAtPeriodEnd: boolean
}

export type SubscriptionDetail = {
  subscription: SubscriptionListItem & {
    providerCustomerId: string
    subjectEntityType: string
    subjectEntityId: string
    lastProviderEventAt: string | null
  }
  billingRecords: Array<{
    id: string
    providerInvoiceId: string | null
    providerChargeId: string | null
    status: 'paid' | 'failed' | 'refunded'
    amountMinor: number
    currencyCode: string
    eventType: string
  }>
}

type StripeIds = {
  providerSubscriptionId: string
  providerCustomerId: string
  externalAccountId?: string
  subjectEntityType?: string
  subjectEntityId?: string
  priceCode?: string
}

function absoluteUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

export function uniqueExternalAccountId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^A-Za-z0-9_-]/g, '_')
}

export async function syncPlans(request: APIRequestContext, token: string): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'POST', '/api/subscriptions/plans/sync', { token, data: {} })
  const body = await readJsonSafe<Record<string, unknown>>(response)
  expect(response.ok(), `POST /api/subscriptions/plans/sync failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  expect(body?.ok).toBe(true)
  return body ?? {}
}

export async function listPlans(request: APIRequestContext, token: string): Promise<{
  items: Array<{ code: string; productCode: string; prices: Array<{ code: string; unitAmountMinor: number }> }>
}> {
  const response = await apiRequest(request, 'GET', '/api/subscriptions/plans', { token })
  const body = await readJsonSafe<{ items?: Array<{ code: string; productCode: string; prices: Array<{ code: string; unitAmountMinor: number }> }> }>(response)
  expect(response.ok(), `GET /api/subscriptions/plans failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { items: Array.isArray(body?.items) ? body.items : [] }
}

export async function createSubscriptionSubject(
  request: APIRequestContext,
  token: string,
  label: string,
): Promise<{ entityId: string; profileId: string }> {
  const response = await apiRequest(request, 'POST', '/api/customers/companies', {
    token,
    data: { displayName: label },
  })
  const body = await readJsonSafe<{ id?: string; companyId?: string }>(response)
  expect(response.ok(), `POST /api/customers/companies failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return {
    entityId: expectId(body?.id, 'Company creation response should include entity id'),
    profileId: expectId(body?.companyId, 'Company creation response should include company profile id'),
  }
}

export async function cleanupSubscriptionSubject(
  request: APIRequestContext,
  token: string | null,
  companyId: string | null,
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
}

export async function createCheckout(
  request: APIRequestContext,
  token: string,
  input: {
    externalAccountId: string
    subjectEntityId: string
    priceCode?: string
  },
): Promise<CheckoutFixture> {
  const response = await apiRequest(request, 'POST', '/api/subscriptions/checkout', {
    token,
    data: {
      externalAccountId: input.externalAccountId,
      subjectEntityType: SUBJECT_ENTITY_TYPE,
      subjectEntityId: input.subjectEntityId,
      priceCode: input.priceCode ?? STARTER_PRICE_CODE,
      successUrl: 'https://merchant.test/subscriptions/success',
      cancelUrl: 'https://merchant.test/subscriptions/cancel',
      allowPromotionCodes: true,
    },
  })
  const body = await readJsonSafe<{ checkoutUrl?: string; provider?: string; subscriptionRequestId?: string }>(response)
  expect(response.ok(), `POST /api/subscriptions/checkout failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  expect(body?.provider).toBe('stripe')
  expect(typeof body?.checkoutUrl).toBe('string')
  expect(typeof body?.subscriptionRequestId).toBe('string')

  const checkoutUrl = body?.checkoutUrl as string
  const parsed = new URL(checkoutUrl)
  return {
    checkoutUrl,
    provider: 'stripe',
    subscriptionRequestId: body?.subscriptionRequestId as string,
    providerSessionId: expectId(parsed.searchParams.get('session'), 'Checkout URL should expose test session id'),
    providerSubscriptionId: expectId(parsed.searchParams.get('subscription'), 'Checkout URL should expose test subscription id'),
    providerCustomerId: expectId(parsed.searchParams.get('customer'), 'Checkout URL should expose test customer id'),
  }
}

export function stripeSubscriptionEvent(
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  ids: StripeIds,
  options?: {
    eventId?: string
    created?: number
    status?: string
    cancelAtPeriodEnd?: boolean
  },
): Record<string, unknown> {
  const created = options?.created ?? Math.floor(Date.now() / 1000)
  const priceCode = ids.priceCode ?? STARTER_PRICE_CODE
  return {
    id: options?.eventId ?? `evt_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created,
    type,
    data: {
      object: {
        id: ids.providerSubscriptionId,
        object: 'subscription',
        customer: ids.providerCustomerId,
        status: options?.status ?? 'active',
        cancel_at_period_end: options?.cancelAtPeriodEnd ?? false,
        canceled_at: null,
        current_period_start: created,
        current_period_end: created + 30 * 24 * 60 * 60,
        trial_end: null,
        metadata: {
          externalAccountId: ids.externalAccountId ?? '',
          subjectEntityType: ids.subjectEntityType ?? SUBJECT_ENTITY_TYPE,
          subjectEntityId: ids.subjectEntityId ?? '',
          priceCode,
        },
        items: {
          object: 'list',
          data: [
            {
              id: `si_${ids.providerSubscriptionId}`,
              object: 'subscription_item',
              price: {
                id: `price_${priceCode}`,
                object: 'price',
                product: `prod_${priceCode}`,
                metadata: { om_price_code: priceCode },
              },
            },
          ],
        },
      },
    },
  }
}

export function stripeInvoiceEvent(
  type: 'invoice.payment_failed' | 'invoice.paid',
  ids: StripeIds,
  options?: {
    eventId?: string
    invoiceId?: string
    created?: number
    amountMinor?: number
    currency?: string
  },
): Record<string, unknown> {
  const created = options?.created ?? Math.floor(Date.now() / 1000)
  const invoiceId = options?.invoiceId ?? `in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const amountMinor = options?.amountMinor ?? 1900
  return {
    id: options?.eventId ?? `evt_invoice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created,
    type,
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        subscription: ids.providerSubscriptionId,
        customer: ids.providerCustomerId,
        amount_due: amountMinor,
        amount_paid: type === 'invoice.paid' ? amountMinor : 0,
        amount_remaining: type === 'invoice.payment_failed' ? amountMinor : 0,
        total: amountMinor,
        currency: options?.currency ?? 'usd',
        period_start: created,
        period_end: created + 30 * 24 * 60 * 60,
        payment_intent: `pi_${invoiceId}`,
        charge: `ch_${invoiceId}`,
      },
    },
  }
}

function signStripePayload(rawBody: string, secret = STRIPE_TEST_WEBHOOK_SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  return `t=${timestamp},v1=${signature}`
}

export async function postStripeWebhook(
  request: APIRequestContext,
  payload: Record<string, unknown>,
  options?: { secret?: string },
): Promise<APIResponse> {
  const rawBody = JSON.stringify(payload)
  return request.fetch(absoluteUrl('/api/payment_gateways/webhook/stripe'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signStripePayload(rawBody, options?.secret),
    },
    data: rawBody,
  })
}

export async function getAccess(
  request: APIRequestContext,
  token: string,
  externalAccountId: string,
): Promise<AccessSnapshot> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/subscriptions/access?externalAccountId=${encodeURIComponent(externalAccountId)}&productCode=${encodeURIComponent(PRODUCT_CODE)}`,
    { token },
  )
  const body = await readJsonSafe<AccessSnapshot>(response)
  expect(response.ok(), `GET /api/subscriptions/access failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body as AccessSnapshot
}

export async function waitForAccess(
  request: APIRequestContext,
  token: string,
  externalAccountId: string,
  expectedState: AccessState,
): Promise<AccessSnapshot> {
  let latest: AccessSnapshot | null = null
  await expect
    .poll(
      async () => {
        latest = await getAccess(request, token, externalAccountId)
        return latest.accessState
      },
      { timeout: 15000, intervals: [100, 200, 300, 500] },
    )
    .toBe(expectedState)
  return latest as AccessSnapshot
}

export async function listSubscriptions(
  request: APIRequestContext,
  token: string,
  externalAccountId: string,
): Promise<{ items: SubscriptionListItem[]; total: number }> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/subscriptions/list?externalAccountId=${encodeURIComponent(externalAccountId)}&pageSize=20`,
    { token },
  )
  const body = await readJsonSafe<{ items?: SubscriptionListItem[]; total?: number }>(response)
  expect(response.ok(), `GET /api/subscriptions/list failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { items: Array.isArray(body?.items) ? body.items : [], total: typeof body?.total === 'number' ? body.total : 0 }
}

export async function getSubscriptionDetail(
  request: APIRequestContext,
  token: string,
  subscriptionId: string,
): Promise<SubscriptionDetail> {
  const response = await apiRequest(request, 'GET', `/api/subscriptions/detail/${encodeURIComponent(subscriptionId)}`, { token })
  const body = await readJsonSafe<SubscriptionDetail>(response)
  expect(response.ok(), `GET /api/subscriptions/detail failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body as SubscriptionDetail
}

export async function cancelSubscription(
  request: APIRequestContext,
  token: string,
  subscriptionId: string,
  atPeriodEnd = true,
): Promise<{ accessState: AccessState; providerStatus: string; cancelAtPeriodEnd: boolean }> {
  const response = await apiRequest(request, 'POST', `/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    token,
    data: { atPeriodEnd },
  })
  const body = await readJsonSafe<{ accessState?: AccessState; providerStatus?: string; cancelAtPeriodEnd?: boolean }>(response)
  expect(response.ok(), `POST /api/subscriptions/[id]/cancel failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body as { accessState: AccessState; providerStatus: string; cancelAtPeriodEnd: boolean }
}

export async function refreshSubscription(
  request: APIRequestContext,
  token: string,
  subscriptionId: string,
): Promise<{ changed: boolean; accessState: AccessState; providerStatus: string }> {
  const response = await apiRequest(request, 'POST', `/api/subscriptions/${encodeURIComponent(subscriptionId)}/refresh`, {
    token,
    data: {},
  })
  const body = await readJsonSafe<{ changed?: boolean; accessState?: AccessState; providerStatus?: string }>(response)
  expect(response.ok(), `POST /api/subscriptions/[id]/refresh failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body as { changed: boolean; accessState: AccessState; providerStatus: string }
}

export async function createPortalSession(
  request: APIRequestContext,
  token: string,
  externalAccountId: string,
): Promise<{ portalUrl: string }> {
  const response = await apiRequest(request, 'POST', '/api/subscriptions/portal', {
    token,
    data: {
      externalAccountId,
      returnUrl: 'https://merchant.test/account/billing',
    },
  })
  const body = await readJsonSafe<{ portalUrl?: string }>(response)
  expect(response.ok(), `POST /api/subscriptions/portal failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body as { portalUrl: string }
}

export async function createActivatedSubscription(
  request: APIRequestContext,
  prefix: string,
): Promise<ActivatedSubscriptionFixture> {
  const token = await getAuthToken(request)
  const { tenantId, organizationId } = getTokenContext(token)
  await syncPlans(request, token)
  const subject = await createSubscriptionSubject(request, token, `QA ${prefix} ${Date.now()}`)
  const externalAccountId = uniqueExternalAccountId(prefix)
  const checkout = await createCheckout(request, token, { externalAccountId, subjectEntityId: subject.profileId })
  const webhook = await postStripeWebhook(
    request,
    stripeSubscriptionEvent('customer.subscription.created', {
      providerSubscriptionId: checkout.providerSubscriptionId,
      providerCustomerId: checkout.providerCustomerId,
      externalAccountId,
      subjectEntityType: SUBJECT_ENTITY_TYPE,
      subjectEntityId: subject.profileId,
      priceCode: STARTER_PRICE_CODE,
    }),
  )
  expect(webhook.status(), `customer.subscription.created webhook should be accepted: ${await webhook.text()}`).toBe(202)
  const access = await waitForAccess(request, token, externalAccountId, 'granted')
  const subscriptionId = expectId(access.subscriptionId, 'Activated access snapshot should include subscriptionId')
  return {
    ...checkout,
    token,
    tenantId,
    organizationId,
    companyId: subject.entityId,
    subjectEntityId: subject.profileId,
    externalAccountId,
    subscriptionId,
  }
}

export async function createAccessOnlyApiKey(request: APIRequestContext, adminToken: string): Promise<{
  roleId: string
  keyId: string
  secret: string
}> {
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `qa-sub-access-${Date.now()}`,
    tenantId,
  })
  const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token: adminToken,
    data: {
      roleId,
      tenantId,
      isSuperAdmin: false,
      features: ['subscriptions.access'],
      organizations: [organizationId],
    },
  })
  expect(aclResponse.ok(), `PUT /api/auth/roles/acl failed: ${aclResponse.status()} ${await aclResponse.text()}`).toBeTruthy()

  const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token: adminToken,
    data: {
      name: `QA Subscriptions Access ${Date.now()}`,
      organizationId,
      roles: [roleId],
    },
  })
  const keyBody = await readJsonSafe<{ id?: string; secret?: string }>(keyResponse)
  expect(keyResponse.ok(), `POST /api/api_keys/keys failed: ${keyResponse.status()} ${JSON.stringify(keyBody)}`).toBeTruthy()
  return {
    roleId,
    keyId: expectId(keyBody?.id, 'API key response should include id'),
    secret: expectId(keyBody?.secret, 'API key response should include secret'),
  }
}

export async function cleanupAccessOnlyApiKey(
  request: APIRequestContext,
  adminToken: string | null,
  fixture: { roleId: string | null; keyId: string | null } | null,
): Promise<void> {
  if (!adminToken || !fixture) return
  if (fixture.keyId) {
    await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(fixture.keyId)}`, { token: adminToken }).catch(() => undefined)
  }
  await deleteRoleIfExists(request, adminToken, fixture.roleId)
}

export async function fetchWithApiKey(
  request: APIRequestContext,
  method: string,
  path: string,
  secret: string,
  data?: unknown,
): Promise<APIResponse> {
  return request.fetch(absoluteUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': secret,
    },
    data,
  })
}

export async function runMercatoCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = {
    ...process.env,
    OM_INTEGRATION_TEST: 'true',
  }
  try {
    const raw = readFileSync('.ai/qa/ephemeral-env.json', 'utf8')
    const parsed = JSON.parse(raw) as { status?: string; databaseUrl?: string }
    if (parsed.status === 'running' && parsed.databaseUrl) {
      env.DATABASE_URL = parsed.databaseUrl
    }
  } catch {
    // Fall back to the caller environment when no ephemeral metadata exists.
  }
  const result = await execFileAsync('yarn', ['mercato', ...args], {
    cwd: process.cwd(),
    timeout: 60000,
    env,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export async function runMercatoCommandExpectFailure(args: string[]): Promise<{ stdout: string; stderr: string; message: string }> {
  try {
    await runMercatoCommand(args)
    throw new Error(`Expected yarn mercato ${args.join(' ')} to fail`)
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string }
    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? '',
      message: execError.message ?? '',
    }
  }
}
