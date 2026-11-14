import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'

test.describe('TC-FORMS-INVALID-ID-001: malformed form read IDs', () => {
  test('returns not found for authenticated malformed detail and submission IDs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    for (const id of ['abc', 'not-a-uuid', 'a'.repeat(300)]) {
      for (const suffix of ['', '/submissions']) {
        const response = await apiRequest(request, 'GET', `/api/forms/${id}${suffix}`, { token })

        expect(response.status(), `${id}${suffix}`).toBe(404)
      }
    }
  })

  test('requires authentication before returning malformed-ID results', async () => {
    await withCredentialIsolatedRequest(async (anonymous) => {
      for (const suffix of ['', '/submissions']) {
        const response = await anonymous.get(`/api/forms/abc${suffix}`)

        expect(response.status(), suffix).toBe(401)
      }
    })
  })
})
