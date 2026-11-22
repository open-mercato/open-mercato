import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

type Fixture = { path: string; id: string; orderId?: string }
type JsonRecord = Record<string, unknown>
const enabled = parseBooleanWithDefault(process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS, false)

export const integrationMeta = { dependsOnModules: ['sales'] }

async function withOrder(request: APIRequestContext, run: (context: {
  token: string; orderId: string; lineId: string;
  status: (kind: 'order' | 'shipment', value: string) => Promise<string>;
  create: (path: string, data: JsonRecord) => Promise<string>;
  post: (path: string, data: JsonRecord) => Promise<APIResponse>;
}) => Promise<void>) {
  const token = await getAuthToken(request, 'admin')
  const fixtures: Fixture[] = []
  const post = async (path: string, data: JsonRecord) => {
    const response = await apiRequest(request, 'POST', path, { token, data })
    if (response.status() === 201) {
      const body = await readJsonSafe<JsonRecord>(response)
      if (typeof body?.id === 'string') {
        fixtures.push({ path, id: body.id, ...(typeof data.orderId === 'string' ? { orderId: data.orderId } : {}) })
      }
    }
    return response
  }
  const create = async (path: string, data: JsonRecord) => {
    const response = await post(path, data)
    expect(response.status(), `POST ${path}: ${await response.text()}`).toBe(201)
    const result = await readJsonSafe<JsonRecord>(response)
    expect(typeof result?.id).toBe('string')
    return result!.id as string
  }
  const status = async (kind: 'order' | 'shipment', value: string) => {
    const path = `/api/sales/${kind}-statuses`
    const response = await apiRequest(request, 'GET', `${path}?search=${encodeURIComponent(value)}&pageSize=100`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items?: JsonRecord[] }>(response)
    const existing = body?.items?.find((item) => item.value === value)
    if (typeof existing?.id === 'string') return existing.id
    return create(path, { value, label: `TC-SALES-058 ${value}`, isDefault: false })
  }
  try {
    const draft = await status('order', 'draft')
    const orderId = await create('/api/sales/orders', {
      currencyCode: 'USD', statusEntryId: draft,
      lines: [{ name: `TC-SALES-058 ${randomUUID()}`, quantity: 2, currencyCode: 'USD', unitPriceNet: 10, unitPriceGross: 10 }],
    })
    const lines = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}`, { token })
    expect(lines.status()).toBe(200)
    const lineId = (await readJsonSafe<{ items?: JsonRecord[] }>(lines))?.items?.[0]?.id
    expect(typeof lineId).toBe('string')
    await run({ token, orderId, lineId: lineId as string, status, create, post })
  } finally {
    for (const fixture of [...fixtures].reverse()) {
      const response = await apiRequest(request, 'DELETE', fixture.path, {
        token, data: { id: fixture.id, ...(fixture.orderId ? { orderId: fixture.orderId } : {}) },
      })
      expect(response.status(), `cleanup ${fixture.path}/${fixture.id}`).toBe(200)
    }
  }
}

test.describe('TC-SALES-058: opt-in sales document workflow guards', () => {
  test('applies the configured activation mode on all three draft-order creation APIs', async ({ request }) => {
    await withOrder(request, async ({ orderId, lineId, create, post }) => {
      const returned = await post('/api/sales/returns', { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] })
      expect(returned.status()).toBe(enabled ? 409 : 400)
      if (enabled) expect((await readJsonSafe<JsonRecord>(returned))?.code).toBe('sales_document_workflow_restricted')
      for (const action of ['shipments', 'invoices']) {
        const data = action === 'shipments'
          ? { orderId, items: [{ orderLineId: lineId, quantity: 1 }] }
          : { orderId, currencyCode: 'USD' }
        if (enabled) {
          const response = await post(`/api/sales/${action}`, data)
          expect(response.status()).toBe(409)
          const body = await readJsonSafe<JsonRecord>(response)
          expect(body?.code).toBe('sales_document_workflow_restricted')
          expect(typeof body?.error).toBe('string')
          expect(String(body?.error)).not.toContain('sales.workflow.')
        } else {
          await create(`/api/sales/${action}`, data)
        }
      }
    })
  })

  test('counts pending shipment quantities only in legacy mode', async ({ request }) => {
    await withOrder(request, async ({ token, orderId, lineId, status, create, post }) => {
      const confirmed = await status('order', 'confirmed')
      const updated = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, statusEntryId: confirmed } })
      expect(updated.status()).toBe(200)
      const pending = await status('shipment', 'pending')
      await create('/api/sales/shipments', { orderId, statusEntryId: pending, items: [{ orderLineId: lineId, quantity: 2 }] })
      const data = { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] }
      if (enabled) {
        const response = await post('/api/sales/returns', data)
        expect(response.status()).toBe(400)
      } else {
        await create('/api/sales/returns', data)
      }
    })
  })

  test('allows invoices and returns on a confirmed order with shipped quantities', async ({ request }) => {
    await withOrder(request, async ({ token, orderId, lineId, status, create }) => {
      const confirmed = await status('order', 'confirmed')
      const updated = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, statusEntryId: confirmed } })
      expect(updated.status()).toBe(200)
      const shipped = await status('shipment', 'shipped')
      await create('/api/sales/shipments', { orderId, statusEntryId: shipped, items: [{ orderLineId: lineId, quantity: 2 }] })
      await create('/api/sales/invoices', { orderId, currencyCode: 'USD' })
      await create('/api/sales/returns', { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] })
    })
  })
})
