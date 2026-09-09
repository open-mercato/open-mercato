import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-041 — custom fields supplied on document create are persisted.
 *
 * The create route folds `cf_*` body keys into `customFields` before handing the
 * payload to `sales.orders.create` / `sales.quotes.create`. Those create schemas
 * used to omit the key, so zod stripped it and the values silently vanished —
 * callers had to create, then immediately update, for a custom field to stick.
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
  expect(response.status(), 'created document should be readable').toBe(200)
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

test.describe('TC-SALES-041: custom fields on sales document create', () => {
  test('order create persists cf_ values without a follow-up update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `sales_create_cf_${stamp}`
    const value = `FS-${stamp}/2026`
    let orderId: string | null = null
    let definitionCreated = false

    try {
      await createDefinition(request, token, 'sales:sales_order', key, `Order CF ${stamp}`)
      definitionCreated = true

      const createResponse = await apiRequest(request, 'POST', ORDERS, {
        token,
        data: { currencyCode: 'USD', lines: [seedLine], [`cf_${key}`]: value },
      })
      const createBody = await readJsonSafe<CreateResponse>(createResponse)

      expect(createResponse.status(), 'order create should succeed').toBe(201)
      orderId = expectId(createBody?.id, 'order create response should contain an id')

      const order = await readDocument(request, token, ORDERS, orderId)
      expect(order, 'created order should appear in the filtered list').toBeDefined()
      expect(
        (order as Record<string, unknown>)[`cf_${key}`],
        'custom field supplied on create should be persisted',
      ).toBe(value)
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDERS, orderId)
      if (definitionCreated) await deleteDefinition(request, token, 'sales:sales_order', key)
    }
  })

  test('quote create persists cf_ values without a follow-up update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `sales_create_cf_q_${stamp}`
    const value = `QT-${stamp}/2026`
    let quoteId: string | null = null
    let definitionCreated = false

    try {
      await createDefinition(request, token, 'sales:sales_quote', key, `Quote CF ${stamp}`)
      definitionCreated = true

      const createResponse = await apiRequest(request, 'POST', QUOTES, {
        token,
        data: { currencyCode: 'USD', lines: [seedLine], [`cf_${key}`]: value },
      })
      const createBody = await readJsonSafe<CreateResponse>(createResponse)

      expect(createResponse.status(), 'quote create should succeed').toBe(201)
      quoteId = expectId(createBody?.id, 'quote create response should contain an id')

      const quote = await readDocument(request, token, QUOTES, quoteId)
      expect(quote, 'created quote should appear in the filtered list').toBeDefined()
      expect(
        (quote as Record<string, unknown>)[`cf_${key}`],
        'custom field supplied on create should be persisted',
      ).toBe(value)
    } finally {
      await deleteSalesEntityIfExists(request, token, QUOTES, quoteId)
      if (definitionCreated) await deleteDefinition(request, token, 'sales:sales_quote', key)
    }
  })
})
