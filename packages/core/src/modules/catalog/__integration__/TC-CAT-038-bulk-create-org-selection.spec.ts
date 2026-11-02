import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CAT-038: bulk-create refuses the organization selections single create refuses (#7076)
 *
 * Under "All organizations" or a selected organization the scope resolver rejects, the
 * bulk-create routes used to answer 202 and write every row into the caller's home
 * organization. They must answer like single create instead and start no job. The
 * rejected requests create nothing, so there is nothing to clean up.
 */
async function postWithSelectedOrg(
  request: APIRequestContext,
  token: string,
  path: string,
  selectedOrg: string,
  data: unknown,
) {
  return apiRequest(request, 'POST', path, {
    token,
    data,
    headers: { Cookie: `om_selected_org=${encodeURIComponent(selectedOrg)}` },
  })
}

test.describe('TC-CAT-038: catalog bulk-create organization selection', () => {
  const stamp = `TC-CAT-038 ${Date.now()}`
  const categoryPayload = { items: [{ name: `${stamp} category` }] }
  const productPayload = { items: [{ title: `${stamp} product` }] }

  test('answers 400 with no job under "All organizations"', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    for (const [path, payload] of [
      ['/api/catalog/categories/bulk-create', categoryPayload],
      ['/api/catalog/products/bulk-create', productPayload],
    ] as const) {
      const response = await postWithSelectedOrg(request, token, path, '__all__', payload)
      expect(response.status(), path).toBe(400)
      const body = (await response.json()) as { ok: boolean; progressJobId: string | null }
      expect(body.ok).toBe(false)
      expect(body.progressJobId).toBeNull()
    }
  })

  test('answers 422 with no job when the selected organization does not resolve', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const missingOrgId = randomUUID()

    for (const [path, payload] of [
      ['/api/catalog/categories/bulk-create', categoryPayload],
      ['/api/catalog/products/bulk-create', productPayload],
    ] as const) {
      const response = await postWithSelectedOrg(request, token, path, missingOrgId, payload)
      expect(response.status(), path).toBe(422)
      const body = (await response.json()) as { ok: boolean; progressJobId: string | null }
      expect(body.ok).toBe(false)
      expect(body.progressJobId).toBeNull()
    }
  })
})
