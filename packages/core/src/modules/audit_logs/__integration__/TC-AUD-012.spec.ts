import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityByPathIfExists, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAuditableDictionaryEntry,
  findActionLog,
  redoAction,
  undoAction,
} from './helpers/auditLogsApi'

test.describe('TC-AUD-012: undo and redo recheck original route features', () => {
  test('denies replay after the actor loses the feature required by the original write route', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Aud012!Pass1'
    const email = `qa-aud-feature-recheck-${stamp}@acme.com`
    const roleName = `qa_aud_feature_recheck_${stamp}`
    const replayFeatures = ['audit_logs.view_self', 'audit_logs.undo_self', 'audit_logs.redo_self']

    let adminToken: string | null = null
    let actorToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const dictionaryIds: string[] = []

    try {
      adminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(adminToken)
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [...replayFeatures, 'dictionaries.manage'],
        organizations: null,
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      actorToken = await getAuthToken(request, email, password)

      const first = await createAuditableDictionaryEntry(request, actorToken, { keyPrefix: 'aud012_undo' })
      dictionaryIds.push(first.dictionaryId)
      const firstLog = await findActionLog(request, adminToken, { resourceId: first.entryId })
      expect(firstLog?.undoToken).toBeTruthy()

      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: replayFeatures,
        organizations: null,
      })
      const deniedUndo = await undoAction(request, actorToken, firstLog!.undoToken!)
      expect(deniedUndo.status()).toBe(403)
      expect((await findActionLog(request, adminToken, { resourceId: first.entryId, logId: firstLog!.id }))?.executionState).toBe('done')

      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [...replayFeatures, 'dictionaries.manage'],
        organizations: null,
      })
      const second = await createAuditableDictionaryEntry(request, actorToken, { keyPrefix: 'aud012_redo' })
      dictionaryIds.push(second.dictionaryId)
      const secondLog = await findActionLog(request, adminToken, { resourceId: second.entryId })
      expect(secondLog?.undoToken).toBeTruthy()
      expect((await undoAction(request, actorToken, secondLog!.undoToken!)).status()).toBe(200)
      expect((await findActionLog(request, adminToken, { resourceId: second.entryId, logId: secondLog!.id }))?.executionState).toBe('undone')

      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: replayFeatures,
        organizations: null,
      })
      const deniedRedo = await redoAction(request, actorToken, secondLog!.id)
      expect(deniedRedo.status()).toBe(403)
      expect((await findActionLog(request, adminToken, { resourceId: second.entryId, logId: secondLog!.id }))?.executionState).toBe('undone')
    } finally {
      for (const dictionaryId of dictionaryIds) {
        await deleteEntityByPathIfExists(request, adminToken, `/api/dictionaries/${encodeURIComponent(dictionaryId)}`)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
