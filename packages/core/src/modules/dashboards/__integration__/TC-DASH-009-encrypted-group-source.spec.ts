import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-DASH-009 — production-boundary coverage for #4622.
 *
 * `sales_orders.shipping_address_snapshot` is encrypted at rest by the default sales encryption
 * map, so grouping analytics by `shippingAddressSnapshot.region` used to bucket and render raw
 * ciphertext. Unit tests mock the SQL connection and the encryption service; this spec exercises the
 * real chain instead — encrypting subscriber → tenant DEK → encrypted JSONB in PostgreSQL → the
 * single and batch widget-data routes — and additionally pins exact `numeric` money totals and
 * tenant/organization scoping.
 *
 * Self-contained: every order and organization it reads is created here and deleted in `finally`.
 */

const API = {
  orders: '/api/sales/orders',
  widgetData: '/api/dashboards/widgets/data',
  widgetDataBatch: '/api/dashboards/widgets/data/batch',
}

/** AES-GCM payloads produced by the encryption layer are `iv:tag:data:v1`. */
const CIPHERTEXT_MARKER = ':v1'

type WidgetDataBucket = { groupKey: unknown; value: number | null; groupLabel?: string | null }
type WidgetDataResponse = { value?: number | null; data?: WidgetDataBucket[] }
type BatchResponse = {
  results?: Array<{ id?: string; ok?: boolean; data?: WidgetDataResponse; error?: string }>
}

function uniqueRegion(suffix: string): string {
  return `QA-DASH-009-${suffix}-${randomUUID().slice(0, 8)}`
}

/** Sums money the way PostgreSQL `numeric` does: on scaled integers, never on binary floats. */
function exactSum(amounts: string[]): number {
  const cents = amounts.reduce((total, amount) => total + Math.round(Number(amount) * 100), 0)
  return cents / 100
}

async function createOrderWithRegion(
  request: APIRequestContext,
  token: string,
  input: { region: string; amount: string; selectedOrgId?: string },
): Promise<string> {
  // Order totals are derived from the lines, so the amount is carried by a single line.
  const payload = {
    currencyCode: 'USD',
    shippingAddressSnapshot: { region: input.region, city: 'QA City', country: 'PL' },
    lines: [
      {
        name: `QA DASH 009 line ${input.region}`,
        currencyCode: 'USD',
        quantity: 1,
        unitPriceNet: input.amount,
        unitPriceGross: input.amount,
      },
    ],
  }
  const response = input.selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'POST', API.orders, {
        token,
        selectedOrgId: input.selectedOrgId,
        data: payload,
      })
    : await apiRequest(request, 'POST', API.orders, { token, data: payload })
  const body = await readJsonSafe<{ id?: string; orderId?: string }>(response)
  expect(response.ok(), `POST ${API.orders} should create the fixture order`).toBeTruthy()
  const id = body?.id ?? body?.orderId
  expect(id, 'order creation response should include an id').toBeTruthy()
  return id as string
}

/**
 * Widget data responses are cached for two minutes keyed by request + scope, so every request this
 * spec issues carries a run-unique positive-amount threshold. It selects the same orders (all
 * fixtures are worth far more than a ten-millionth of a unit) while keeping each run — and each
 * Playwright retry — off the previous run's cache entry.
 */
function buildRegionRequest(threshold: number) {
  return {
    entityType: 'sales:orders',
    metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
    groupBy: { field: 'shippingAddressSnapshot.region', limit: 100 },
    filters: [{ field: 'grandTotalGrossAmount', operator: 'gt', value: threshold }],
  }
}

async function fetchRegionBuckets(
  request: APIRequestContext,
  token: string,
  threshold: number,
): Promise<{ raw: string; buckets: WidgetDataBucket[] }> {
  const response = await apiRequest(request, 'POST', API.widgetData, {
    token,
    data: buildRegionRequest(threshold),
  })
  expect(response.status(), 'widget data should aggregate an encrypted group source').toBe(200)
  const raw = await response.text()
  const body = JSON.parse(raw) as WidgetDataResponse
  return { raw, buckets: Array.isArray(body.data) ? body.data : [] }
}

function findBucket(buckets: WidgetDataBucket[], region: string): WidgetDataBucket | undefined {
  return buckets.find((bucket) => bucket.groupKey === region)
}

test.describe('TC-DASH-009: encrypted group sources in dashboard widget data', () => {
  test('TC-DASH-009: single and batch widget data group encrypted shipping regions as plaintext with exact totals', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(
      !(await canManageSalesOrders(request, adminToken)),
      'Sales order writes are not permitted for this actor (role ACLs not synced).',
    )

    const scope = getTokenScope(adminToken)
    const primaryRegion = uniqueRegion('primary')
    const secondaryRegion = uniqueRegion('secondary')
    const foreignRegion = uniqueRegion('foreign-org')
    const primaryAmounts = ['0.10', '0.20']
    const secondaryAmount = '12345.67'
    // Positive, far below every fixture amount, unique per run — see buildRegionRequest.
    const amountThreshold = Number(`0.000000${Math.floor(Math.random() * 900) + 100}`)

    const orderIds: string[] = []
    let foreignOrgId: string | null = null
    let foreignOrderId: string | null = null

    try {
      for (const amount of primaryAmounts) {
        orderIds.push(await createOrderWithRegion(request, adminToken, { region: primaryRegion, amount }))
      }
      orderIds.push(
        await createOrderWithRegion(request, adminToken, { region: secondaryRegion, amount: secondaryAmount }),
      )

      const { raw, buckets } = await fetchRegionBuckets(request, adminToken, amountThreshold)

      // The defect: ciphertext used to arrive as the group key.
      expect(raw).not.toContain(CIPHERTEXT_MARKER)

      const primaryBucket = findBucket(buckets, primaryRegion)
      const secondaryBucket = findBucket(buckets, secondaryRegion)
      expect(primaryBucket, 'the decrypted primary region should be its own bucket').toBeTruthy()
      expect(secondaryBucket, 'the decrypted secondary region should be its own bucket').toBeTruthy()

      // 0.10 + 0.20 is 0.30000000000000004 in binary floating point; the exact path returns 0.3.
      expect(primaryBucket?.value).toBe(exactSum(primaryAmounts))
      expect(secondaryBucket?.value).toBe(exactSum([secondaryAmount]))

      // Buckets are ordered by value descending, so a null-valued bucket never displaces a real one.
      const values = buckets.map((bucket) => bucket.value)
      const firstNullIndex = values.indexOf(null)
      if (firstNullIndex >= 0) {
        expect(values.slice(firstNullIndex).every((value) => value === null)).toBe(true)
      }

      const batchResponse = await apiRequest(request, 'POST', API.widgetDataBatch, {
        token: adminToken,
        data: {
          requests: [
            { id: 'encrypted-regions', request: buildRegionRequest(amountThreshold) },
            {
              id: 'invalid-field',
              request: {
                entityType: 'sales:orders',
                metric: { field: 'doesNotExist', aggregate: 'count' },
              },
            },
          ],
        },
      })
      const batchRaw = await batchResponse.text()
      expect(batchResponse.status(), 'batch widget data should return 200').toBe(200)
      expect(batchRaw).not.toContain(CIPHERTEXT_MARKER)

      const batchBody = JSON.parse(batchRaw) as BatchResponse
      const encryptedResult = batchBody.results?.find((result) => result.id === 'encrypted-regions')
      expect(encryptedResult?.ok, 'the encrypted grouping request should succeed in a batch').toBe(true)
      const batchBuckets = Array.isArray(encryptedResult?.data?.data) ? encryptedResult!.data!.data! : []
      expect(findBucket(batchBuckets, primaryRegion)?.value).toBe(exactSum(primaryAmounts))
      expect(findBucket(batchBuckets, secondaryRegion)?.value).toBe(exactSum([secondaryAmount]))

      const invalidResult = batchBody.results?.find((result) => result.id === 'invalid-field')
      expect(invalidResult?.ok, 'an invalid request should fail in isolation').toBe(false)
      expect(invalidResult?.error).toContain('Invalid metric field')

      // Organization scoping: an order placed in another organization must not join these buckets.
      foreignOrgId = await createOrganizationFixture(request, adminToken, {
        name: `QA DASH 009 ${randomUUID().slice(0, 8)}`,
        tenantId: scope.tenantId,
      })
      foreignOrderId = await createOrderWithRegion(request, adminToken, {
        region: foreignRegion,
        amount: '999.99',
        selectedOrgId: foreignOrgId,
      })

      const scoped = await fetchRegionBuckets(request, adminToken, amountThreshold)
      expect(scoped.raw).not.toContain(CIPHERTEXT_MARKER)
      expect(findBucket(scoped.buckets, foreignRegion), 'another organization must not leak into the buckets').toBeUndefined()
      expect(findBucket(scoped.buckets, primaryRegion)?.value).toBe(exactSum(primaryAmounts))
    } finally {
      for (const orderId of [...orderIds, foreignOrderId]) {
        await deleteSalesEntityIfExists(request, adminToken, API.orders, orderId)
      }
      await deleteOrganizationIfExists(request, adminToken, foreignOrgId)
    }
  })
})
