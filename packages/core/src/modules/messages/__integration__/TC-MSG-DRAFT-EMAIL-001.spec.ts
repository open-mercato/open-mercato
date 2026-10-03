import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

for (const inheritedVisibility of [false, true]) {
  test(`TC-MSG-DRAFT-EMAIL-001: public draft send requires messages.email (inherited: ${inheritedVisibility})`, async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = randomUUID()
    const roleName = `qa-draft-email-${stamp}`
    const email = `qa-draft-email-${stamp}@example.test`
    const password = 'QaDraftEmail1!'
    let roleId: string | null = null
    let userId: string | null = null
    let actorToken: string | null = null
    let draftId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: roleName })
      await setRoleAclFeatures(request, adminToken, {
        roleId, features: ['messages.compose', 'messages.view'], organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email, password, organizationId, roles: [roleName],
      })
      actorToken = await getAuthToken(request, email, password)
      draftId = await composeMessageWithToken(request, actorToken, {
        visibility: 'internal', isDraft: true, recipients: [{ userId }],
        subject: `Draft permission ${stamp}`, body: 'Permission regression',
      })
      const path = `/api/messages/${draftId}`
      const publicFields = { visibility: 'public', externalEmail: `recipient-${stamp}@example.test` }

      if (inheritedVisibility) {
        const edit = await apiRequest(request, 'PATCH', path, { token: actorToken, data: publicFields })
        expect(edit.status()).toBe(200)
      }

      const sendInput = { isDraft: false, ...(inheritedVisibility ? {} : publicFields) }
      const denied = await apiRequest(request, 'PATCH', path, { token: actorToken, data: sendInput })
      expect(denied.status()).toBe(403)
      const unchanged = await apiRequest(request, 'GET', `${path}?skipMarkRead=1`, { token: actorToken })
      expect(unchanged.status()).toBe(200)
      expect(await readJsonSafe<{ isDraft: boolean }>(unchanged)).toMatchObject({ isDraft: true })

      await setRoleAclFeatures(request, adminToken, {
        roleId, features: ['messages.compose', 'messages.view', 'messages.email'], organizations: [organizationId],
      })
      const allowed = await apiRequest(request, 'PATCH', path, { token: actorToken, data: sendInput })
      expect(allowed.status()).toBe(200)
      const sent = await apiRequest(request, 'GET', `${path}?skipMarkRead=1`, { token: actorToken })
      expect(sent.status()).toBe(200)
      expect(await readJsonSafe<{ isDraft: boolean; visibility: string }>(sent)).toMatchObject({
        isDraft: false, visibility: 'public',
      })
    } finally {
      if (actorToken) await deleteMessageIfExists(request, actorToken, draftId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
}
