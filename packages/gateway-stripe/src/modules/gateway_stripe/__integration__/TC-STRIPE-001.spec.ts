import { createHmac, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationInDb,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-STRIPE-001: Stripe charge webhooks drive the persisted gateway transaction
 *
 * Signed Stripe events are POSTed to the real `/api/payment_gateways/webhook/stripe` route, which
 * verifies the signature with the organization's saved credentials, locates the transaction by the
 * PaymentIntent the Charge references, and syncs it through the payment service and state machine.
 * Assertions read `gateway_transactions` and `gateway_webhook_events` in Postgres.
 *
 * Transactions are seeded with SQL: creating a real Stripe session needs a Stripe account. No
 * Stripe API is contacted — webhook verification is local HMAC. Covers partial → full refunds,
 * duplicate, stale and concurrent delivery, a refund that overtakes the capture, pre-Basil and
 * Basil partial-capture payloads, and two organizations holding a transaction for the same
 * PaymentIntent with their own webhook secrets.
 *
 * Targets the default inline processing, where every processed event advances `last_webhook_at`
 * (status-neutral deliveries are awaited through it). The async Stripe worker records nothing on the
 * transaction for status-neutral events; it and the failure → redelivery path are covered by
 * `__tests__/webhook-refund-ordering.test.ts` through the real route and payment service.
 *
 * ENVIRONMENT: API + raw `pg` against `DATABASE_URL`; run under a coherent app+DB stack
 * (`yarn test:integration` / `yarn test:integration:ephemeral`).
 */

const WEBHOOK_PATH = '/api/payment_gateways/webhook/stripe'
const LEGACY_API_VERSION = '2025-02-24.acacia'
const BASIL_API_VERSION = '2025-03-31.basil'

type Scope = { organizationId: string; tenantId: string }

type TransactionRow = {
  unified_status: string
  captured_amount: string
  gateway_status: string | null
  last_webhook_at: Date | null
}

type CredentialsSnapshot = { id: string; credentials: unknown } | null

const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`
const webhookSecret = `whsec_tcstripe001_${stamp}`
let eventSequence = 0

function nextEventId(): string {
  eventSequence += 1
  return `evt_tcstripe001_${stamp}_${eventSequence}`
}

function signedBody(type: string, object: Record<string, unknown>, apiVersion: string, eventId = nextEventId()): { eventId: string; body: string } {
  return {
    eventId,
    body: JSON.stringify({
      id: eventId,
      object: 'event',
      api_version: apiVersion,
      type,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object },
    }),
  }
}

function signatureHeader(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

async function postWebhook(request: APIRequestContext, body: string, secret = webhookSecret): Promise<number> {
  const response = await request.post(WEBHOOK_PATH, {
    headers: { 'content-type': 'application/json', 'stripe-signature': signatureHeader(body, secret) },
    data: body,
  })
  return response.status()
}

async function deliver(
  request: APIRequestContext,
  type: string,
  object: Record<string, unknown>,
  apiVersion = LEGACY_API_VERSION,
): Promise<{ eventId: string; body: string; status: number }> {
  const event = signedBody(type, object, apiVersion)
  return { ...event, status: await postWebhook(request, event.body) }
}

function charge(paymentIntentId: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `ch_${paymentIntentId}`,
    object: 'charge',
    payment_intent: paymentIntentId,
    amount: 1000,
    amount_captured: 1000,
    amount_refunded: 0,
    captured: true,
    refunded: false,
    currency: 'usd',
    status: 'succeeded',
    ...overrides,
  }
}

async function seedTransaction(scope: Scope, input: { paymentIntentId: string; status: string; capturedAmount: string }): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into gateway_transactions
         (id, payment_id, provider_key, provider_session_id, unified_status, amount, captured_amount, currency_code,
          organization_id, tenant_id, created_at, updated_at)
       values (gen_random_uuid(), gen_random_uuid(), 'stripe', $1, $2, 10, $3, 'USD', $4, $5, now(), now())
       returning id`,
      [input.paymentIntentId, input.status, input.capturedAmount, scope.organizationId, scope.tenantId],
    )
    return result.rows[0].id
  })
}

async function readTransaction(id: string): Promise<TransactionRow> {
  return withClient(async (client) => {
    const result = await client.query<TransactionRow>(
      'select unified_status, captured_amount::text as captured_amount, gateway_status, last_webhook_at from gateway_transactions where id = $1',
      [id],
    )
    return result.rows[0]
  })
}

async function statusOf(id: string): Promise<string> {
  return (await readTransaction(id)).unified_status
}

async function lastWebhookAt(id: string): Promise<number> {
  return (await readTransaction(id)).last_webhook_at?.getTime() ?? 0
}

async function deliverAndWait(
  request: APIRequestContext,
  transactionId: string,
  type: string,
  object: Record<string, unknown>,
  apiVersion = LEGACY_API_VERSION,
): Promise<void> {
  const before = await lastWebhookAt(transactionId)
  expect((await deliver(request, type, object, apiVersion)).status).toBe(202)
  await expect.poll(() => lastWebhookAt(transactionId)).toBeGreaterThan(before)
}

async function countClaims(eventId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      "select count(*)::text as count from gateway_webhook_events where provider_key = 'stripe' and idempotency_key = $1",
      [eventId],
    )
    return Number(result.rows[0].count)
  })
}

async function snapshotCredentials(scope: Scope): Promise<CredentialsSnapshot> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string; credentials: unknown }>(
      `select id, credentials from integration_credentials
        where integration_id = 'gateway_stripe' and organization_id = $1 and tenant_id = $2
          and user_id is null and deleted_at is null
        limit 1`,
      [scope.organizationId, scope.tenantId],
    )
    return result.rows[0] ?? null
  })
}

async function restoreCredentials(scope: Scope, snapshot: CredentialsSnapshot): Promise<void> {
  await withClient(async (client) => {
    if (snapshot) {
      await client.query('update integration_credentials set credentials = $2::json where id = $1', [
        snapshot.id,
        JSON.stringify(snapshot.credentials),
      ])
      return
    }
    await client.query(
      `delete from integration_credentials
        where integration_id = 'gateway_stripe' and organization_id = $1 and tenant_id = $2 and user_id is null`,
      [scope.organizationId, scope.tenantId],
    )
  })
}

test.describe('TC-STRIPE-001: Stripe charge webhooks drive the persisted gateway transaction', () => {
  let scope: Scope
  let credentialsSnapshot: CredentialsSnapshot = null
  const transactionIds: string[] = []
  let otherOrganizationId: string | null = null

  test.beforeAll(async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenScope = getTokenScope(token)
    scope = { organizationId: tokenScope.organizationId, tenantId: tokenScope.tenantId }
    credentialsSnapshot = await snapshotCredentials(scope)
    const response = await apiRequest(request, 'PUT', '/api/integrations/gateway_stripe/credentials', {
      token,
      data: {
        credentials: {
          publishableKey: 'pk_test_tcstripe001',
          secretKey: 'sk_test_tcstripe001',
          webhookSecret,
        },
      },
    })
    expect(response.status(), await response.text()).toBe(200)
  })

  test.afterAll(async () => {
    await withClient(async (client) => {
      if (transactionIds.length > 0) {
        await client.query('delete from gateway_transactions where id = any($1::uuid[])', [transactionIds])
      }
      await client.query("delete from gateway_webhook_events where provider_key = 'stripe' and idempotency_key like $1", [
        `evt_tcstripe001_${stamp}_%`,
      ])
    })
    if (scope) await restoreCredentials(scope, credentialsSnapshot)
    await deleteIntegrationCredentialsInDb(otherOrganizationId)
    await deleteOrganizationInDb(otherOrganizationId)
  })

  async function seed(status: string, capturedAmount = status === 'captured' ? '10' : '0'): Promise<{ id: string; paymentIntentId: string }> {
    const paymentIntentId = `pi_tcstripe001_${stamp}_${transactionIds.length + 1}`
    const id = await seedTransaction(scope, { paymentIntentId, status, capturedAmount })
    transactionIds.push(id)
    return { id, paymentIntentId }
  }

  test('moves a captured payment from partial to full refund, once per event, and keeps it refunded on a stale partial', async ({ request }) => {
    const { id, paymentIntentId } = await seed('captured')

    const firstPartial = await deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 400 }))
    expect(firstPartial.status).toBe(202)
    await expect.poll(() => statusOf(id)).toBe('partially_refunded')
    expect((await readTransaction(id)).gateway_status).toBe('charge.refunded')

    expect(await postWebhook(request, firstPartial.body)).toBe(202)
    expect(await countClaims(firstPartial.eventId)).toBeGreaterThanOrEqual(1)
    expect(await statusOf(id)).toBe('partially_refunded')

    await deliverAndWait(request, id, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 700 }))
    expect(await statusOf(id)).toBe('partially_refunded')
    expect((await deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 1000, refunded: true }))).status).toBe(202)
    await expect.poll(() => statusOf(id)).toBe('refunded')

    await deliverAndWait(request, id, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 400 }))
    expect(await statusOf(id)).toBe('refunded')
  })

  test('records a refund that overtakes the capture and ignores the late payment_intent.succeeded', async ({ request }) => {
    const { id, paymentIntentId } = await seed('pending')

    expect((await deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 400 }))).status).toBe(202)
    await expect.poll(() => statusOf(id)).toBe('partially_refunded')
    expect(Number((await readTransaction(id)).captured_amount)).toBe(10)

    await deliverAndWait(request, id, 'payment_intent.succeeded', {
      id: paymentIntentId, object: 'payment_intent', status: 'succeeded', amount: 1000, amount_received: 1000,
    })
    expect(await statusOf(id)).toBe('partially_refunded')

    expect((await deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 1000, refunded: true }))).status).toBe(202)
    await expect.poll(() => statusOf(id)).toBe('refunded')
  })

  test('reads a pre-Basil partial capture: the uncaptured remainder is not a refund', async ({ request }) => {
    const { id, paymentIntentId } = await seed('partially_captured', '6')
    const partialCapture = { amount_captured: 600 }

    await deliverAndWait(request, id, 'charge.refunded', charge(paymentIntentId, { ...partialCapture, amount_refunded: 400 }), LEGACY_API_VERSION)
    expect(await statusOf(id)).toBe('partially_captured')

    await deliver(request, 'charge.refunded', charge(paymentIntentId, { ...partialCapture, amount_refunded: 700 }), LEGACY_API_VERSION)
    await expect.poll(() => statusOf(id)).toBe('partially_refunded')
    await deliver(request, 'charge.refunded', charge(paymentIntentId, { ...partialCapture, amount_refunded: 1000, refunded: true }), LEGACY_API_VERSION)
    await expect.poll(() => statusOf(id)).toBe('refunded')
    expect(Number((await readTransaction(id)).captured_amount)).toBe(6)
  })

  test('reads a Basil partial capture: a refund of 3 out of 6 captured is a partial refund', async ({ request }) => {
    const { id, paymentIntentId } = await seed('partially_captured', '6')
    const partialCapture = { amount_captured: 600 }

    await deliver(request, 'charge.refunded', charge(paymentIntentId, { ...partialCapture, amount_refunded: 300 }), BASIL_API_VERSION)
    await expect.poll(() => statusOf(id)).toBe('partially_refunded')
    await deliver(request, 'charge.refunded', charge(paymentIntentId, { ...partialCapture, amount_refunded: 600, refunded: true }), BASIL_API_VERSION)
    await expect.poll(() => statusOf(id)).toBe('refunded')
  })

  test('applies concurrent refund and capture deliveries without losing the refund', async ({ request }) => {
    const pairs: Array<{ id: string; paymentIntentId: string }> = []
    for (let index = 0; index < 15; index += 1) pairs.push(await seed('captured'))
    const refundDeliveries = await Promise.all(pairs.flatMap(({ paymentIntentId }) => [
      deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 400 })),
      deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 1000, refunded: true })),
    ]))
    expect(refundDeliveries.map((delivery) => delivery.status)).toEqual(refundDeliveries.map(() => 202))
    for (const { id } of pairs) {
      await expect.poll(() => statusOf(id)).toBe('refunded')
    }

    const pending = [await seed('pending'), await seed('pending'), await seed('pending')]
    const captureRaceDeliveries = await Promise.all(pending.flatMap(({ paymentIntentId }) => [
      deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 400 })),
      deliver(request, 'payment_intent.succeeded', {
        id: paymentIntentId, object: 'payment_intent', status: 'succeeded', amount: 1000, amount_received: 1000,
      }),
    ]))
    expect(captureRaceDeliveries.map((delivery) => delivery.status)).toEqual(captureRaceDeliveries.map(() => 202))
    for (const { id } of pending) {
      await expect.poll(() => statusOf(id)).toBe('partially_refunded')
    }
  })

  test('changes only the transaction of the organization whose secret signed the event', async ({ request }) => {
    const { id, paymentIntentId } = await seed('captured')
    otherOrganizationId = await createOrganizationInDb({ name: `TC-STRIPE-001 other ${stamp}`, tenantId: scope.tenantId })
    const superadminToken = await getAuthToken(request, 'superadmin')
    const otherSecret = `whsec_tcstripe001_other_${stamp}`
    const saved = await apiRequest(request, 'PUT', '/api/integrations/gateway_stripe/credentials', {
      token: superadminToken,
      headers: {
        Cookie: `om_selected_tenant=${encodeURIComponent(scope.tenantId)}; om_selected_org=${encodeURIComponent(otherOrganizationId)}`,
      },
      data: { credentials: { publishableKey: 'pk_test_tcstripe001_other', secretKey: 'sk_test_tcstripe001_other', webhookSecret: otherSecret } },
    })
    expect(saved.status(), await saved.text()).toBe(200)
    const otherId = await seedTransaction(
      { organizationId: otherOrganizationId, tenantId: scope.tenantId },
      { paymentIntentId, status: 'captured', capturedAmount: '10' },
    )
    transactionIds.push(otherId)

    const forged = signedBody('charge.refunded', charge(paymentIntentId, { amount_refunded: 1000, refunded: true }), LEGACY_API_VERSION)
    expect(await postWebhook(request, forged.body, `whsec_forged_${stamp}`)).toBe(401)
    expect(await statusOf(id)).toBe('captured')
    expect(await statusOf(otherId)).toBe('captured')

    const signedByOther = signedBody('charge.refunded', charge(paymentIntentId, { amount_refunded: 400 }), LEGACY_API_VERSION)
    expect(await postWebhook(request, signedByOther.body, otherSecret)).toBe(202)
    await expect.poll(() => statusOf(otherId)).toBe('partially_refunded')
    expect(await statusOf(id)).toBe('captured')

    expect((await deliver(request, 'charge.refunded', charge(paymentIntentId, { amount_refunded: 1000, refunded: true }))).status).toBe(202)
    await expect.poll(() => statusOf(id)).toBe('refunded')
    expect(await statusOf(otherId)).toBe('partially_refunded')
  })
})
