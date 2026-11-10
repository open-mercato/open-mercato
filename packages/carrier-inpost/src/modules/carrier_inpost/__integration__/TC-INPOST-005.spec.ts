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
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * TC-INPOST-005: An InPost parcel complaint ("claimed") does not cancel the shipment
 *
 * InPost reports `claimed` when the recipient files a complaint at the parcel machine. That is a
 * failed delivery, not a cancelled label: the shipment must stay non-terminal so the carrier's
 * later outcome (here `returned_to_sender`) is still applied.
 *
 * Shipments are seeded with SQL in a throwaway organization (creating a real InPost shipment needs
 * an InPost account). Signed webhooks are POSTed to the real `/api/shipping-carriers/webhook/inpost`
 * route; verification is local HMAC with the organization's saved webhook secret.
 *
 * ENVIRONMENT: API + raw `pg` against `DATABASE_URL`; run under a coherent app+DB stack
 * (`yarn test:integration` / `yarn test:integration:ephemeral`).
 */

const WEBHOOK_PATH = '/api/shipping-carriers/webhook/inpost'
const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`
const webhookSecret = `tcinpost005_${stamp}`

type Scope = { organizationId: string; tenantId: string }
type ShipmentRow = { unified_status: string; carrier_status: string | null }

async function seedShipment(scope: Scope, carrierShipmentId: string, status: string): Promise<string> {
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into carrier_shipments
        (id, order_id, provider_key, carrier_shipment_id, tracking_number, unified_status,
         organization_id, tenant_id, created_at, updated_at)
       values ($1, $2, 'inpost', $3, $3, $4, $5, $6, now(), now())`,
      [id, randomUUID(), carrierShipmentId, status, scope.organizationId, scope.tenantId],
    )
  })
  return id
}

async function readShipment(id: string): Promise<ShipmentRow | null> {
  return withClient(async (client) => {
    const result = await client.query<ShipmentRow>(
      'select unified_status, carrier_status from carrier_shipments where id = $1',
      [id],
    )
    return result.rows[0] ?? null
  })
}

async function isClaimProcessed(idempotencyKey: string): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query(
      "select 1 from carrier_webhook_events where provider_key = 'inpost' and idempotency_key = $1",
      [idempotencyKey],
    )
    return (result.rowCount ?? 0) > 0
  })
}

async function deliverStatus(
  request: APIRequestContext,
  carrierShipmentId: string,
  status: string,
): Promise<void> {
  const eventTs = new Date().toISOString()
  const body = JSON.stringify({
    event: 'shipment_status_changed',
    event_ts: eventTs,
    organization_id: 1,
    payload: { shipment_id: carrierShipmentId, status, tracking_number: carrierShipmentId },
  })
  const idempotencyKey = [carrierShipmentId, 'shipment_status_changed', status, eventTs].join(':')
  const response = await request.post(WEBHOOK_PATH, {
    data: body,
    headers: {
      'content-type': 'application/json',
      'x-inpost-signature': createHmac('sha256', webhookSecret).update(body).digest('hex'),
    },
  })
  expect(response.status(), `webhook ${status} should be accepted`).toBe(202)
  await drainIntegrationQueue('shipping-carriers-webhook')
  await expect
    .poll(() => isClaimProcessed(idempotencyKey), {
      message: `the ${status} webhook should be processed by the worker`,
      timeout: 30_000,
    })
    .toBe(true)
}

test.describe('TC-INPOST-005: InPost "claimed" is a failed delivery, not a cancellation', () => {
  test('keeps a complained parcel trackable until InPost returns it to the sender', async ({ request }) => {
    test.setTimeout(120_000)
    const adminScope = getTokenScope(await getAuthToken(request, 'admin'))
    const tenantId = adminScope.tenantId
    let organizationId: string | null = null
    const shipmentIds: string[] = []

    try {
      organizationId = await createOrganizationInDb({ name: `TC-INPOST-005 ${stamp}`, tenantId })
      const scope: Scope = { organizationId, tenantId }
      const superadminToken = await getAuthToken(request, 'superadmin')
      const saved = await apiRequest(request, 'PUT', '/api/integrations/carrier_inpost/credentials', {
        token: superadminToken,
        headers: {
          Cookie: `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=${encodeURIComponent(organizationId)}`,
        },
        data: { credentials: { apiToken: `tcinpost005_token_${stamp}`, organizationId: '1', webhookSecret } },
      })
      expect(saved.status(), await saved.text()).toBe(200)

      const awaitingPickup = `tcinpost005a${stamp}`
      const awaitingPickupId = await seedShipment(scope, awaitingPickup, 'out_for_delivery')
      shipmentIds.push(awaitingPickupId)
      const pickupExpired = `tcinpost005b${stamp}`
      const pickupExpiredId = await seedShipment(scope, pickupExpired, 'failed_delivery')
      shipmentIds.push(pickupExpiredId)

      await deliverStatus(request, awaitingPickup, 'claimed')
      await expect
        .poll(async () => readShipment(awaitingPickupId), { timeout: 10_000 })
        .toEqual({ unified_status: 'failed_delivery', carrier_status: 'claimed' })

      await deliverStatus(request, pickupExpired, 'claimed')

      await deliverStatus(request, pickupExpired, 'returned_to_sender')
      await expect
        .poll(async () => (await readShipment(pickupExpiredId))?.unified_status, {
          message: 'the return after a complaint must still be applied',
          timeout: 10_000,
        })
        .toBe('returned')
    } finally {
      await withClient(async (client) => {
        if (organizationId) {
          await client.query('delete from carrier_webhook_events where organization_id = $1', [organizationId])
        }
        if (shipmentIds.length > 0) {
          await client.query('delete from carrier_shipments where id = any($1::uuid[])', [shipmentIds])
        }
      }).catch(() => undefined)
      await deleteIntegrationCredentialsInDb(organizationId).catch(() => undefined)
      await deleteOrganizationInDb(organizationId).catch(() => undefined)
    }
  })
})
