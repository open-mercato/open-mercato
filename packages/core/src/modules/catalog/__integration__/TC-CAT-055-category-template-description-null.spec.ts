import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-055: category and option schema template descriptions accept an explicit null
 *
 * `GET /api/catalog/categories` and `GET /api/catalog/option-schemas` return
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
  path: string,
  listPath: string,
  recordId: string,
): Promise<void> {
  const clear = await apiRequest(request, 'PUT', path, { token, data: { id: recordId, description: null } })
  expect(clear.status(), `PUT ${path} with description null should succeed`).toBe(200)
  expect(await readDescription(request, token, listPath, recordId)).toBeNull()
}

test.describe('TC-CAT-055: category and option schema template descriptions accept an explicit null', () => {
  test('PUT /api/catalog/categories clears the description on null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let categoryId: string | null = null

    try {
      categoryId = await createRecord(request, token, '/api/catalog/categories', {
        name: `QA TC-CAT-055 Category ${stamp}`,
        description: `QA TC-CAT-055 category description ${stamp}`,
      })
      const listPath = `/api/catalog/categories?ids=${encodeURIComponent(categoryId)}`
      await expectDescriptionCleared(request, token, '/api/catalog/categories', listPath, categoryId)
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/catalog/categories', categoryId)
    }
  })

  test('PUT /api/catalog/option-schemas clears the description on null', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let templateId: string | null = null

    try {
      templateId = await createRecord(request, token, '/api/catalog/option-schemas', {
        name: `QA TC-CAT-055 Template ${stamp}`,
        description: `QA TC-CAT-055 template description ${stamp}`,
        schema: { options: [] },
      })
      const listPath = `/api/catalog/option-schemas?id=${encodeURIComponent(templateId)}`
      await expectDescriptionCleared(request, token, '/api/catalog/option-schemas', listPath, templateId)
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/catalog/option-schemas', templateId)
    }
  })
})
