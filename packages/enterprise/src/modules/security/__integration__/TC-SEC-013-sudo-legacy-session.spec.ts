import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  buildSudoScopeCookie,
  createPasswordSudoConfig,
  createSudoTestContext,
  deleteSudoFixtures,
  insertLegacyUnboundSudoSession,
  readSudoSession,
  verifySudoChallenge,
} from './helpers/sudoFixtures'

test.describe('TC-SEC-013: Legacy unbound sudo sessions', () => {
  test('fails closed when a pre-migration session has no immutable binding fields', async ({ request }) => {
    const context = await createSudoTestContext(request)
    const targetIdentifier = `security.qa.sudo-legacy-${Date.now()}-${randomUUID()}`
    const cookie = buildSudoScopeCookie(context.tenantId, context.organizationId)
    let configId: string | null = null
    let sessionId: string | null = null

    try {
      configId = await createPasswordSudoConfig({
        targetIdentifier,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        configuredBy: context.userId,
      })
      sessionId = await insertLegacyUnboundSudoSession({
        userId: context.userId,
        tenantId: context.tenantId,
      })

      const verification = await verifySudoChallenge(request, {
        token: context.token,
        sessionId,
        targetIdentifier,
        password: context.password,
        cookie,
      })
      expect(verification.status, 'an unbound legacy session should be indistinguishable from a missing session').toBe(404)
      expect(verification.body.sudoToken).toBeUndefined()

      const stored = await readSudoSession(sessionId)
      expect(stored?.targetIdentifier).toBeNull()
      expect(stored?.sudoConfigId).toBeNull()
      expect(stored?.sudoConfigUpdatedAt).toBeNull()
      expect(stored?.verifiedAt).toBeNull()
    } finally {
      await deleteSudoFixtures({
        configIds: configId ? [configId] : [],
        sessionIds: sessionId ? [sessionId] : [],
      })
    }
  })
})
