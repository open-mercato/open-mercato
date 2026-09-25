import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-042 — custom fields supplied on document update refresh the query index.
 *
 * PUT wrote EAV custom fields but skipped `emitCrudSideEffects`, so the list GET
 * kept stale `customValues` from the query-index projection while scalar updates
 * appeared to work (#6217). Create already indexed custom fields (TC-SALES-041);
 * this spec pins update, clear, and scalar-only refresh for orders and quotes.
 */

const DEFINITIONS = '/api/entities/definitions'
const ORDERS = '/api/sales/orders'
const QUOTES = '/api/sales/quotes'

type CreateResponse = { id?: string }
type DocumentRecord = Record<string, unknown> & { id?: string }
type ListResponse = { items?: DocumentRecord[] }

async function createDefinition(
  request: APIRequestContext,
  token: string,
  entityId: string,
  key: string,
  label: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', DEFINITIONS, {
    token,
    data: { entityId, key, kind: 'text', label, formEditable: true, listVisible: true },
  })
  expect(response.ok(), `custom field definition create failed (${response.status()})`).toBeTruthy()
}

async function deleteDefinition(
  request: APIRequestContext,
  token: string,
  entityId: string,
  key: string,
): Promise<void> {
  await apiRequest(
    request,
    'DELETE',
    `${DEFINITIONS}?entityId=${encodeURIComponent(entityId)}&key=${encodeURIComponent(key)}`,
    { token },
  ).catch(() => {})
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<DocumentRecord | undefined> {
  const response = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(id)}`, {
    token,
  })
  expect(response.status(), 'document should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse>(response)
  return body?.items?.find((item) => item.id === id)
}

const seedLine = {
  currencyCode: 'USD',
  quantity: 1,
  name: 'QA seed line',
  unitPriceNet: 0,
  unitPriceGross: 0,
}

test.describe('TC-SALES-042: custom fields on sales document update', () => {
  test('order update persists cf_ values and refreshes the list projection', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `sales_update_cf_${stamp}`
    const initialValue = `FS-${stamp}/2026`
    const updatedValue = `FS-${stamp}/2027`
    let orderId: string | null = null
    let definitionCreated = false

    try {
      await createDefinition(request, token, 'sales:sales_order', key, `Order CF ${stamp}`)
      definitionCreated = true

      const createResponse = await apiRequest(request, 'POST', ORDERS, {
        token,
        data: { currencyCode: 'USD', lines: [seedLine], [`cf_${key}`]: initialValue },
      })
      const createBody = await readJsonSafe<CreateResponse>(createResponse)
      expect(createResponse.status(), 'order create should succeed').toBe(201)
      orderId = expectId(createBody?.id, 'order create response should contain an id')

      const created = await readDocument(request, token, ORDERS, orderId)
      expect((created as Record<string, unknown>)[`cf_${key}`]).toBe(initialValue)

      const updateResponse = await apiRequest(request, 'PUT', ORDERS, {
        token,
        data: { id: orderId, [`cf_${key}`]: updatedValue },
      })
      expect(updateResponse.status(), 'order update should succeed').toBe(200)

      const updated = await readDocument(request, token, ORDERS, orderId)
      expect(
        (updated as Record<string, unknown>)[`cf_${key}`],
        'custom field update should appear on the next GET',
      ).toBe(updatedValue)

      const clearResponse = await apiRequest(request, 'PUT', ORDERS, {
        token,
        data: { id: orderId, customFields: { [key]: null } },
      })
      expect(clearResponse.status(), 'order custom field clear should succeed').toBe(200)

      const cleared = await readDocument(request, token, ORDERS, orderId)
      expect(
        (cleared as Record<string, unknown>)[`cf_${key}`],
        'null custom field value should clear the projection',
      ).toBeFalsy()

      const scalarResponse = await apiRequest(request, 'PUT', ORDERS, {
        token,
        data: { id: orderId, comment: `QA scalar refresh ${stamp}` },
      })
      expect(scalarResponse.status(), 'scalar-only order update should succeed').toBe(200)

      const afterScalar = await readDocument(request, token, ORDERS, orderId)
      expect(afterScalar?.comment, 'scalar update should persist').toBe(`QA scalar refresh ${stamp}`)
      expect(
        (afterScalar as Record<string, unknown>)[`cf_${key}`],
        'scalar-only update should still refresh the custom field projection',
      ).toBeFalsy()
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDERS, orderId)
      if (definitionCreated) await deleteDefinition(request, token, 'sales:sales_order', key)
    }
  })

  test('quote update persists cf_ values and refreshes the list projection', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `sales_update_cf_q_${stamp}`
    const initialValue = `QT-${stamp}/2026`
    const updatedValue = `QT-${stamp}/2027`
    let quoteId: string | null = null
    let definitionCreated = false

    try {
      await createDefinition(request, token, 'sales:sales_quote', key, `Quote CF ${stamp}`)
      definitionCreated = true

      const createResponse = await apiRequest(request, 'POST', QUOTES, {
        token,
        data: { currencyCode: 'USD', lines: [seedLine], [`cf_${key}`]: initialValue },
      })
      const createBody = await readJsonSafe<CreateResponse>(createResponse)
      expect(createResponse.status(), 'quote create should succeed').toBe(201)
      quoteId = expectId(createBody?.id, 'quote create response should contain an id')

      const created = await readDocument(request, token, QUOTES, quoteId)
      expect((created as Record<string, unknown>)[`cf_${key}`]).toBe(initialValue)

      const updateResponse = await apiRequest(request, 'PUT', QUOTES, {
        token,
        data: { id: quoteId, [`cf_${key}`]: updatedValue },
      })
      expect(updateResponse.status(), 'quote update should succeed').toBe(200)

      const updated = await readDocument(request, token, QUOTES, quoteId)
      expect(
        (updated as Record<string, unknown>)[`cf_${key}`],
        'custom field update should appear on the next GET',
      ).toBe(updatedValue)

      const clearResponse = await apiRequest(request, 'PUT', QUOTES, {
        token,
        data: { id: quoteId, customFields: { [key]: null } },
      })
      expect(clearResponse.status(), 'quote custom field clear should succeed').toBe(200)

      const cleared = await readDocument(request, token, QUOTES, quoteId)
      expect(
        (cleared as Record<string, unknown>)[`cf_${key}`],
        'null custom field value should clear the projection',
      ).toBeFalsy()

      const scalarResponse = await apiRequest(request, 'PUT', QUOTES, {
        token,
        data: { id: quoteId, comment: `QA scalar refresh ${stamp}` },
      })
      expect(scalarResponse.status(), 'scalar-only quote update should succeed').toBe(200)

      const afterScalar = await readDocument(request, token, QUOTES, quoteId)
      expect(afterScalar?.comment, 'scalar update should persist').toBe(`QA scalar refresh ${stamp}`)
      expect(
        (afterScalar as Record<string, unknown>)[`cf_${key}`],
        'scalar-only update should still refresh the custom field projection',
      ).toBeFalsy()
    } finally {
      await deleteSalesEntityIfExists(request, token, QUOTES, quoteId)
      if (definitionCreated) await deleteDefinition(request, token, 'sales:sales_quote', key)
    }
  })
})
