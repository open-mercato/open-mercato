import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFixedTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  deleteTemplate,
  updateTemplate,
} from './helpers/fixtures'

const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const STALE_EXPECTED_AT = '2020-01-01T00:00:00.000Z'

function resolveUrl(path: string): string {
  const base = process.env.BASE_URL?.trim() || null
  return base ? `${base}${path}` : path
}

// Regression for #2529 (alinadivante comment 4638514821, "TC A" optimistic-lock gap):
// editing a checkout template that was deleted in another tab must surface a clean
// optimistic-lock conflict (409) when the client sent the expected-version header —
// not a bare "Template not found" 404. Plain API clients that send no header keep the
// existing 404 (fail-open).
test.describe('TC-CHKT-041: Checkout template stale-edit after delete', () => {
  test('PUT with stale optimistic-lock header on a deleted template returns 409 conflict', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let templateId: string | null = null

    try {
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({ status: 'draft' }))

      // Simulate "deleted in another tab".
      const deleteResponse = await deleteTemplate(request, token, templateId)
      expect(deleteResponse.ok(), 'template delete fixture should succeed').toBeTruthy()

      // Replay a stale edit carrying the optimistic-lock header → expect 409.
      const conflictResponse = await request.fetch(resolveUrl(`/api/checkout/templates/${encodeURIComponent(templateId)}`), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER]: STALE_EXPECTED_AT,
        },
        data: { name: 'QA stale edit' },
      })
      expect(conflictResponse.status(), 'stale edit after delete should be a 409 conflict').toBe(409)
      const conflictBody = await readJsonSafe<{ code?: string }>(conflictResponse)
      expect(conflictBody?.code, 'conflict body should carry the optimistic-lock code').toBe('optimistic_lock_conflict')

      // Without the header, the same edit keeps the plain 404 (fail-open).
      const notFoundResponse = await updateTemplate(request, token, templateId, { name: 'QA stale edit no header' })
      expect(notFoundResponse.status(), 'no-header edit after delete should stay 404').toBe(404)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
