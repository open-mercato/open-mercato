import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createScopedUser, deleteScopedUser, type ScopedUserFixture } from './helpers/explainApi'
import { explainAccess, explainAccessOk } from './helpers/priceAccessApi'

export const integrationMeta = {
  description: 'Insights "Why?" access explanation',
  dependsOnModules: ['insights', 'auth', 'customers'],
}

const GRANTED_FEATURE = 'customers.people.view'
const MISSING_FEATURE = 'customers.deals.view'

/**
 * TC-INS-021: Access explanation with detail gating
 * Covers:
 *   - GET /api/insights/explain/access?features=…            (self)
 *   - GET /api/insights/explain/access?features=…&userId=…   (another user)
 *
 * A user lacking a feature gets a minimal explanation of their own access (decision,
 * per-feature grants, reasons, no detail) and cannot explain another user (403 without
 * `insights.explain.access_detail` and `auth.users.list`). The administrator, who holds
 * both, gets the detail (grant source, roles, roles that would grant, recent ACL
 * changes) for that user and for themselves; an unknown user is 404.
 */
test.describe('TC-INS-021: explain access decisions with detail gating', () => {
  test('explains a missing feature minimally to the user and in detail to an administrator', async ({ request }) => {
    let adminToken: string | null = null
    const limitedFixture: ScopedUserFixture = { roleId: null, userId: null }

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { userId: adminUserId } = getTokenScope(adminToken)
      const limited = await createScopedUser(request, adminToken, limitedFixture, {
        label: 'INS-021 limited',
        features: [GRANTED_FEATURE],
      })

      const self = await explainAccessOk(request, limited.token, { features: [GRANTED_FEATURE, MISSING_FEATURE] })
      expect(self).toEqual({
        decision: 'denied',
        required: [
          { feature: GRANTED_FEATURE, granted: true },
          { feature: MISSING_FEATURE, granted: false },
        ],
        reasons: ['missing_feature'],
        summary: { key: 'insights.explain.access.summary.missingFeature', params: { features: MISSING_FEATURE, count: 1 } },
        detail: null,
        confidence: 'proven',
      })

      const outsideRbac = await explainAccessOk(request, limited.token, { features: [GRANTED_FEATURE], path: '/backend/customers/people' })
      expect(outsideRbac).toMatchObject({ decision: 'granted', reasons: ['not_determinable'], confidence: 'unknown', detail: null })

      const unknownFeature = await explainAccess(request, limited.token, { features: ['customers.qa_unknown_feature.view'] })
      expect(unknownFeature.status, unknownFeature.text).toBe(400)
      expect(unknownFeature.body).toEqual({ error: 'unknown_feature', details: { features: ['customers.qa_unknown_feature.view'] } })

      const limitedOnAdmin = await explainAccess(request, limited.token, { features: [MISSING_FEATURE], userId: adminUserId })
      expect(limitedOnAdmin.status, 'explaining another user without access_detail and auth.users.list').toBe(403)
      expect(limitedOnAdmin.body).toEqual({ error: 'forbidden' })

      const adminView = await explainAccessOk(request, adminToken, { features: [GRANTED_FEATURE, MISSING_FEATURE], userId: limited.userId })
      expect(adminView.decision).toBe('denied')
      expect(adminView.reasons).toEqual(['missing_feature'])
      const detail = adminView.detail
      expect(detail, 'an administrator with access_detail gets the detail').not.toBeNull()
      expect(detail).toMatchObject({
        subject: { kind: 'user', id: limited.userId, isSelf: false },
        source: 'roles',
        organizationAllowed: true,
        userAcl: null,
        consistentWithFreshRead: true,
        features: [
          { feature: GRANTED_FEATURE, granted: true, reason: null },
          { feature: MISSING_FEATURE, granted: false, reason: 'missing_feature' },
        ],
      })
      expect(detail?.roles).toEqual([
        expect.objectContaining({ id: limitedFixture.roleId, appliesToOrganization: true, grantedFeatures: [GRANTED_FEATURE] }),
      ])
      expect(detail?.rolesThatWouldGrant?.length ?? 0, 'some tenant role grants both features (admin holds auth.roles.list)').toBeGreaterThan(0)
      expect((detail?.rolesThatWouldGrant ?? []).map((role) => role.id)).not.toContain(limitedFixture.roleId)
      expect(detail?.recentChanges?.some((change) => change.kind === 'role_acl' && change.resourceId === limitedFixture.roleId)).toBe(true)

      const adminSelf = await explainAccessOk(request, adminToken, { features: [MISSING_FEATURE] })
      expect(adminSelf.decision).toBe('granted')
      expect(adminSelf.detail).toMatchObject({ subject: { kind: 'user', id: adminUserId, isSelf: true } })

      const missingUser = await explainAccess(request, adminToken, { features: [MISSING_FEATURE], userId: randomUUID() })
      expect(missingUser.status).toBe(404)
      expect(missingUser.body).toEqual({ error: 'not_found' })
    } finally {
      await deleteScopedUser(request, adminToken, limitedFixture)
    }
  })
})
