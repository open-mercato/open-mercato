import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-057: sales channel and shipping method descriptions accept an explicit null
 *
 * `GET /api/sales/channels` and `GET /api/sales/shipping-methods` return
 * `description: null` for a record with no description, but the write schemas
 * rejected that same value with a 400, so a description could not be cleared
 * once set. An explicit null now clears it.
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
  input: { path: string; listPath: string; recordId: string; body: Record<string, unknown>; description: string },
): Promise<void> {
  expect(await readDescription(request, token, input.listPath, input.recordId)).toBe(input.description)
  const clear = await apiRequest(request, 'PUT', input.path, {
    token,
    data: { ...input.body, id: input.recordId, description: null },
  })
  expect(clear.status(), `PUT ${input.path} with description null should succeed`).toBe(200)
  expect(await readDescription(request, token, input.listPath, input.recordId)).toBeNull()
}

test.describe('TC-SALES-057: sales channel and shipping method descriptions accept an explicit null', () => {
  test('PUT /api/sales/channels clears the description on null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const code = `qa-tc-sales-057-${stamp}`
    const description = `QA TC-SALES-057 channel description ${stamp}`
    let channelId: string | null = null

    try {
      channelId = await createRecord(request, token, '/api/sales/channels', {
        name: `QA TC-SALES-057 Channel ${stamp}`,
        code,
        description,
      })
      await expectDescriptionCleared(request, token, {
        path: '/api/sales/channels',
        listPath: `/api/sales/channels?ids=${encodeURIComponent(channelId)}`,
        recordId: channelId,
        body: { code },
        description,
      })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/sales/channels', channelId)
    }
  })

  test('PUT /api/sales/shipping-methods clears the description on null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const description = `QA TC-SALES-057 shipping method description ${stamp}`
    let shippingMethodId: string | null = null

    try {
      shippingMethodId = await createRecord(request, token, '/api/sales/shipping-methods', {
        name: `QA TC-SALES-057 Shipping ${stamp}`,
        code: `qa-tc-sales-057-${stamp}`,
        description,
      })
      await expectDescriptionCleared(request, token, {
        path: '/api/sales/shipping-methods',
        listPath: `/api/sales/shipping-methods?id=${encodeURIComponent(shippingMethodId)}`,
        recordId: shippingMethodId,
        body: {},
        description,
      })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/sales/shipping-methods', shippingMethodId)
    }
  })
})
