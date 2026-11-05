import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  uniqueLabel,
} from './helpers'

type DraftReplyResponse = {
  ok?: boolean
  draft?: string
  notConfigured?: boolean
  aiUnavailable?: boolean
  error?: string
}

test.describe('TC-WC-013: warranty claims AI draft reply API', () => {
  test('enforces auth/manage gates, degrades cleanly when no LLM is configured, and 404s unknown claims', async ({ request }) => {
    const unauth = await request.post('/api/warranty_claims/ai/draft-reply', {
      headers: { 'Content-Type': 'application/json', Cookie: '' },
      data: { claimId: randomUUID() },
    })
    expect(unauth.status(), 'AI draft route should require staff auth').toBe(401)

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = uniqueLabel('tc-wc-013')

    let viewOnlyRoleId: string | null = null
    let viewOnlyUserId: string | null = null
    let claimId: string | null = null

    try {
      viewOnlyRoleId = await createRoleFixture(request, superadminToken, {
        tenantId,
        name: `QA WC AI View Role ${stamp}`,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewOnlyRoleId,
        features: ['warranty_claims.claim.view'],
        organizations: [organizationId],
      })
      const password = 'Valid1!Pass'
      const email = `${stamp}@test.invalid`
      viewOnlyUserId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [viewOnlyRoleId],
        name: `QA WC AI View User ${stamp}`,
      })
      const viewOnlyToken = await getAuthToken(request, email, password)

      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC AI Customer ${stamp}`,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            productName: `QA WC AI Product ${stamp}`,
            faultDescription: 'Customer asked for a warranty update',
            qtyClaimed: 1,
          },
        ],
      })
      claimId = claim.id

      const forbidden = await apiRequest(request, 'POST', '/api/warranty_claims/ai/draft-reply', {
        token: viewOnlyToken,
        data: { claimId },
      })
      expect(forbidden.status(), 'view-only employee should not draft AI replies').toBe(403)

      const draftResponse = await apiRequest(request, 'POST', '/api/warranty_claims/ai/draft-reply', {
        token: adminToken,
        data: { claimId, tone: 'friendly' },
      })
      const draftBody = await readJsonSafe<DraftReplyResponse>(draftResponse)
      if (draftResponse.status() === 422) {
        expect(draftBody?.notConfigured, 'LLM-unconfigured response should set notConfigured=true').toBe(true)
      } else if (draftResponse.status() === 502) {
        expect(draftBody?.aiUnavailable, 'provider-failure response should set aiUnavailable=true').toBe(true)
      } else {
        expect(draftResponse.status(), `AI draft route should return 200 or documented 422/502: ${JSON.stringify(draftBody)}`).toBe(200)
        expect(draftBody?.ok).toBe(true)
        expect(typeof draftBody?.draft).toBe('string')
        expect((draftBody?.draft ?? '').trim().length, 'AI draft should be non-empty when provider is configured').toBeGreaterThan(0)
      }

      const missingClaim = await apiRequest(request, 'POST', '/api/warranty_claims/ai/draft-reply', {
        token: adminToken,
        data: { claimId: randomUUID() },
      })
      expect(missingClaim.status(), 'AI draft route should 404 unknown claim ids before model resolution').toBe(404)
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteUserIfExists(request, superadminToken, viewOnlyUserId)
      await deleteRoleIfExists(request, superadminToken, viewOnlyRoleId)
    }
  })
})
