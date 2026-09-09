import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  buildSudoScopeCookie,
  createPasswordSudoConfig,
  createSudoTestContext,
  deleteSudoFixtures,
  initiateSudoChallenge,
  readSudoSession,
  verifySudoChallenge,
} from './helpers/sudoFixtures'

test.describe('TC-SEC-010: Sudo challenge binding substitution', () => {
  test('rejects target, tenant, and organization substitution before password verification', async ({ request }) => {
    const context = await createSudoTestContext(request)
    const stamp = `${Date.now()}-${randomUUID()}`
    const targetIdentifier = `security.qa.sudo-binding-${stamp}`
    const originalCookie = buildSudoScopeCookie(context.tenantId, context.organizationId)
    let configId: string | null = null
    let alternateOrganizationId: string | null = null
    const sessionIds: string[] = []

    try {
      alternateOrganizationId = await createOrganizationFixture(request, context.token, {
        name: `QA SEC 010 alternate organization ${stamp}`,
        tenantId: context.tenantId,
      })
      configId = await createPasswordSudoConfig({
        targetIdentifier,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        configuredBy: context.userId,
      })

      const initiate = async () => {
        const response = await initiateSudoChallenge(request, {
          token: context.token,
          targetIdentifier,
          cookie: originalCookie,
        })
        expect(response.status, 'sudo challenge initiation should succeed').toBe(200)
        expect(response.body.required).toBe(true)
        expect(response.body.method).toBe('password')
        expect(response.body.sessionId).toBeTruthy()
        sessionIds.push(response.body.sessionId as string)
        return response.body.sessionId as string
      }

      const targetSessionId = await initiate()
      const targetSubstitution = await verifySudoChallenge(request, {
        token: context.token,
        sessionId: targetSessionId,
        targetIdentifier: `${targetIdentifier}.substituted`,
        password: 'WrongPassword123!',
        cookie: originalCookie,
      })
      expect(targetSubstitution.status, 'target substitution should fail at the binding guard').toBe(403)

      const organizationSessionId = await initiate()
      const organizationSubstitution = await verifySudoChallenge(request, {
        token: context.token,
        sessionId: organizationSessionId,
        targetIdentifier,
        password: 'WrongPassword123!',
        cookie: buildSudoScopeCookie(context.tenantId, alternateOrganizationId),
      })
      expect(organizationSubstitution.status, 'organization substitution should fail at the binding guard').toBe(403)

      const tenantSessionId = await initiate()
      const tenantSubstitution = await verifySudoChallenge(request, {
        token: context.token,
        sessionId: tenantSessionId,
        targetIdentifier,
        password: 'WrongPassword123!',
        cookie: buildSudoScopeCookie(randomUUID(), alternateOrganizationId),
      })
      expect(tenantSubstitution.status, 'tenant substitution should fail at the binding guard').toBe(403)

      for (const sessionId of sessionIds) {
        const session = await readSudoSession(sessionId)
        expect(session?.verifiedAt, 'a substituted challenge must remain pending').toBeNull()
      }
    } finally {
      await deleteSudoFixtures({
        configIds: configId ? [configId] : [],
        sessionIds,
      })
      await deleteOrganizationIfExists(request, context.token, alternateOrganizationId)
    }
  })
})
