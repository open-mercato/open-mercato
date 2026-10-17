import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEAL_RESOURCE_KIND,
  createQaDeal,
  createScopedUser,
  deleteQaDealIfExists,
  deleteScopedUser,
  explainFieldOk,
  updateQaDeal,
  uniqueSuffix,
  type ScopedUserFixture,
} from './helpers/explainApi'

/**
 * TC-INS-012: Viewer redaction without tenant audit access
 * Covers:
 *   - GET /api/insights/explain?resourceKind=customers.deal&field=status
 *
 * A viewer holding the deal features, `insights.explain.view` and
 * `audit_logs.view_self` (but NOT `audit_logs.view_tenant`) sees other users as an
 * anonymous redacted actor and cannot see past values of their changes, while the
 * current value and their own change stay fully visible. The tenant admin sees
 * every actor and value of the same chain.
 */
test.describe('TC-INS-012: explain redacts other users for a viewer without audit_logs.view_tenant', () => {
  test('hides the admin identity and past values but shows the current value and own changes', async ({ request }) => {
    let adminToken: string | null = null
    let dealId: string | null = null
    const viewerFixture: ScopedUserFixture = { roleId: null, userId: null }

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { userId: adminUserId } = getTokenScope(adminToken)
      const suffix = uniqueSuffix()
      const adminStatus = `qa_admin_${suffix}`
      const viewerStatus = `qa_viewer_${suffix}`
      dealId = await createQaDeal(request, adminToken, { title: `QA INS-012 ${suffix}`, status: 'open' })
      await updateQaDeal(request, adminToken, dealId, { status: adminStatus })

      const viewer = await createScopedUser(request, adminToken, viewerFixture, {
        label: 'INS-012 viewer',
        features: [
          'customers.people.view',
          'customers.deals.view',
          'customers.deals.manage',
          'insights.explain.view',
          'audit_logs.view_self',
        ],
      })
      await updateQaDeal(request, viewer.token, dealId, { status: viewerStatus })
      const query = { resourceKind: DEAL_RESOURCE_KIND, resourceId: dealId, field: 'status' }

      const body = await explainFieldOk(request, viewer.token, query)
      expect(body.viewer).toEqual({ canSeeActors: false, canSeePastValues: false, canSeeOwnValues: true })
      expect(body.current.value, 'the current value is always shown').toBe(viewerStatus)
      expect(body.verdict).toBe('explained')

      const [own, ...others] = body.chain
      expect(others.length, 'the admin create and update are part of the chain').toBeGreaterThanOrEqual(2)
      expect(own.actor).toEqual(expect.objectContaining({ kind: 'user', id: viewer.userId, isSelf: true, redacted: false }))
      expect(own.from).toEqual(expect.objectContaining({ value: adminStatus, redacted: false }))
      expect(own.to).toEqual(expect.objectContaining({ value: viewerStatus, redacted: false }))

      for (const entry of others) {
        expect(entry.actor, `${entry.logId} hides the other user`).toEqual({
          kind: 'user',
          id: null,
          label: null,
          isSelf: false,
          redacted: true,
        })
        for (const side of [entry.from, entry.to]) {
          if (!side) continue
          expect(side.redacted, `${entry.logId} redacts past values of another user`).toBe(true)
          expect(side.value).toBeNull()
          expect(side.display).toBeNull()
        }
      }
      expect(JSON.stringify(body), 'the admin user id never reaches the viewer').not.toContain(adminUserId)
      expect(JSON.stringify(others), 'the admin-written past value never reaches the viewer').not.toContain(adminStatus)

      const adminView = await explainFieldOk(request, adminToken, query)
      expect(adminView.viewer.canSeeActors).toBe(true)
      expect(adminView.chain[0].actor).toEqual(expect.objectContaining({ id: viewer.userId, isSelf: false, redacted: false }))
      expect(adminView.chain[1].actor).toEqual(expect.objectContaining({ id: adminUserId, isSelf: true, redacted: false }))
      expect(adminView.chain[1].to?.value, 'the tenant admin sees past values').toBe(adminStatus)
    } finally {
      await deleteQaDealIfExists(request, adminToken, dealId)
      await deleteScopedUser(request, adminToken, viewerFixture)
    }
  })
})
