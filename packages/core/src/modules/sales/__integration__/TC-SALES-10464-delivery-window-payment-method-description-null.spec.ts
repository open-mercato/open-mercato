import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-10464: delivery window and payment method descriptions accept an explicit null
 *
 * `GET /api/sales/delivery-windows` and `GET /api/sales/payment-methods` return
 * `description: null` for a record with no description, but the write schemas
 * rejected that same value with a 400. An explicit null now clears the
 * description.
 */
async function createRecord(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `POST ${path} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `POST ${path} should return an id`)
}

async function readDescription(
  request: APIRequestContext,
  token: string,
  listPath: string,
  recordId: string,
): Promise<string | null | undefined> {
  const response = await apiRequest(request, 'GET', listPath, { token })
  expect(response.ok(), `GET ${listPath} should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string; description?: string | null }> }>(response)
  const record = (body?.items ?? []).find((item) => item.id === recordId)
  expect(record, 'the record should be listed').toBeTruthy()
  return record?.description
}

async function expectDescriptionCleared(
  request: APIRequestContext,
  token: string,
  input: { path: string; recordId: string; description: string },
): Promise<void> {
  const listPath = `${input.path}?ids=${encodeURIComponent(input.recordId)}`
  expect(await readDescription(request, token, listPath, input.recordId)).toBe(input.description)
  const clear = await apiRequest(request, 'PUT', input.path, {
    token,
    data: { id: input.recordId, description: null },
  })
  expect(clear.status(), `PUT ${input.path} with description null should succeed`).toBe(200)
  expect(await readDescription(request, token, listPath, input.recordId)).toBeNull()
}

test.describe('TC-SALES-10464: delivery window and payment method descriptions accept an explicit null', () => {
  test('PUT /api/sales/delivery-windows clears the description on null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const description = `QA TC-SALES-10464 delivery window description ${stamp}`
    let deliveryWindowId: string | null = null

    try {
      deliveryWindowId = await createRecord(request, token, '/api/sales/delivery-windows', {
        name: `QA TC-SALES-10464 Window ${stamp}`,
        code: `qa-tc-sales-058-${stamp}`,
        description,
      })
      await expectDescriptionCleared(request, token, {
        path: '/api/sales/delivery-windows',
        recordId: deliveryWindowId,
        description,
      })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/sales/delivery-windows', deliveryWindowId)
    }
  })

  test('PUT /api/sales/payment-methods clears the description on null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const description = `QA TC-SALES-10464 payment method description ${stamp}`
    let paymentMethodId: string | null = null

    try {
      paymentMethodId = await createRecord(request, token, '/api/sales/payment-methods', {
        name: `QA TC-SALES-10464 Payment ${stamp}`,
        code: `qa-tc-sales-058-${stamp}`,
        description,
      })
      await expectDescriptionCleared(request, token, {
        path: '/api/sales/payment-methods',
        recordId: paymentMethodId,
        description,
      })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/sales/payment-methods', paymentMethodId)
    }
  })
})
