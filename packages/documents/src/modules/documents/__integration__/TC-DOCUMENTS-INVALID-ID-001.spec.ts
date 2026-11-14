import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

const SUFFIXES = ['', '/content', '/versions', '/comments', '/shares']

test.describe('TC-DOCUMENTS-INVALID-ID-001: malformed document read IDs', () => {
  test('returns not found for malformed detail and child read IDs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    for (const id of ['abc', 'not-a-uuid', 'a'.repeat(300)]) {
      for (const suffix of SUFFIXES) {
        const response = await apiRequest(request, 'GET', `/api/documents/${id}${suffix}`, { token })

        expect(response.status(), `${id}${suffix}`).toBe(404)
      }
    }
  })

  test('requires authentication before returning malformed-ID results', async () => {
    await withCredentialIsolatedRequest(async (anonymous) => {
      for (const suffix of SUFFIXES) {
        const response = await anonymous.get(`/api/documents/abc${suffix}`)

        expect(response.status(), suffix).toBe(401)
      }
    })
  })
})
