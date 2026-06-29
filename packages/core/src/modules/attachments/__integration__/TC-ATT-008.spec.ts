import { expect, request as playwrightRequest, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/**
 * TC-ATT-008: RBAC — 401 on missing auth and 403 on missing feature gates
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surfaces: /api/attachments (view/manage), /api/attachments/library (view),
 *           /api/attachments/library/{id} (view/manage)
 *
 * The catch-all API guard returns 401 when authentication is required and absent,
 * and 403 ({ error: 'Forbidden', requiredFeatures }) for an authenticated caller
 * lacking the declared features. The gate runs before the route handler, so query
 * validity is irrelevant for the negative cases.
 */
test.describe('TC-ATT-008: Attachment RBAC and feature gates', () => {
  test('should enforce 401 without auth and 403 without attachments features', async ({ request, baseURL }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const recordId = `qa-rbac-008-${stamp}`
    const recordQuery = `entityId=${encodeURIComponent('attachments:library')}&recordId=${encodeURIComponent(recordId)}`
    const unprivilegedEmail = `qa-att-008-noaccess-${stamp}@test.invalid`

    let attachmentId: string | null = null
    let unprivilegedUserId: string | null = null

    try {
      // An authenticated principal with no roles → no attachments.* features.
      unprivilegedUserId = await createUserFixture(request, adminToken, {
        email: unprivilegedEmail,
        password: 'Valid1!Pass',
        organizationId,
        roles: [],
      })
      const unprivilegedToken = await getAuthToken(request, unprivilegedEmail, 'Valid1!Pass')

      // Seed an attachment as admin so the detail-route checks have a real target.
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'rbac-008.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('rbac gate fixture', 'utf8'),
      })
      attachmentId = uploaded.id
      const detailPath = `/api/attachments/library/${encodeURIComponent(attachmentId)}`

      // GET /api/attachments without any token → 401.
      const anonymous = await playwrightRequest.newContext({ baseURL: baseURL ?? BASE_URL })
      try {
        const recordListNoAuth = await anonymous.fetch(`/api/attachments?${recordQuery}`, {
          method: 'GET',
        })
        expect(recordListNoAuth.status(), 'GET /api/attachments without auth should be 401').toBe(401)

        // GET /api/attachments/library without any token → 401.
        const libraryNoAuth = await anonymous.fetch('/api/attachments/library', { method: 'GET' })
        expect(libraryNoAuth.status(), 'GET /api/attachments/library without auth should be 401').toBe(401)
      } finally {
        await anonymous.dispose()
      }

      // GET /api/attachments with an unprivileged user (lacks attachments.view) → 403.
      const recordListForbidden = await apiRequest(request, 'GET', `/api/attachments?${recordQuery}`, {
        token: unprivilegedToken,
      })
      expect(recordListForbidden.status(), 'GET /api/attachments without attachments.view should be 403').toBe(403)

      // GET /api/attachments/library with unprivileged user (lacks attachments.view) → 403.
      const libraryForbidden = await apiRequest(request, 'GET', '/api/attachments/library', {
        token: unprivilegedToken,
      })
      expect(libraryForbidden.status(), 'GET /api/attachments/library without attachments.view should be 403').toBe(403)

      // GET /api/attachments/library/{id} with unprivileged user (lacks attachments.view) → 403.
      const detailForbidden = await apiRequest(request, 'GET', detailPath, { token: unprivilegedToken })
      expect(detailForbidden.status(), 'GET detail without attachments.view should be 403').toBe(403)

      // PATCH /api/attachments/library/{id} with unprivileged user (lacks attachments.manage) → 403.
      const patchForbidden = await apiRequest(request, 'PATCH', detailPath, {
        token: unprivilegedToken,
        data: { tags: ['blocked'] },
      })
      expect(patchForbidden.status(), 'PATCH detail without attachments.manage should be 403').toBe(403)

      // DELETE /api/attachments/library/{id} with unprivileged user (lacks attachments.manage) → 403.
      const deleteForbidden = await apiRequest(request, 'DELETE', detailPath, { token: unprivilegedToken })
      expect(deleteForbidden.status(), 'DELETE detail without attachments.manage should be 403').toBe(403)

      // Admin with the features can read the same record → 200 (positive control).
      const detailOk = await apiRequest(request, 'GET', detailPath, { token: adminToken })
      expect(detailOk.status(), 'admin GET detail should be 200').toBe(200)
      const detailBody = await readJsonSafe<{ item?: { id?: string } }>(detailOk)
      expect(detailBody?.item?.id).toBe(attachmentId)
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await deleteUserIfExists(request, adminToken, unprivilegedUserId)
    }
  })
})
