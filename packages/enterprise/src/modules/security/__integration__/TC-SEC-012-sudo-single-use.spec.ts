import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  buildSudoScopeCookie,
  createPasswordSudoConfig,
  createSudoTestContext,
  deleteSudoFixtures,
  initiateSudoChallenge,
  readSudoSession,
  verifySudoChallenge,
} from './helpers/sudoFixtures'

test.describe('TC-SEC-012: Sudo session single-use CAS', () => {
  test('allows exactly one concurrent verification to consume a pending session', async ({ request }) => {
    const context = await createSudoTestContext(request)
    const targetIdentifier = `security.qa.sudo-single-use-${Date.now()}-${randomUUID()}`
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
      const initiated = await initiateSudoChallenge(request, {
        token: context.token,
        targetIdentifier,
        cookie,
      })
      expect(initiated.status).toBe(200)
      expect(initiated.body.method).toBe('password')
      expect(initiated.body.sessionId).toBeTruthy()
      sessionId = initiated.body.sessionId as string

      const verify = () => verifySudoChallenge(request, {
        token: context.token,
        sessionId: sessionId as string,
        targetIdentifier,
        password: context.password,
        cookie,
      })
      const attempts = await Promise.all([verify(), verify()])
      expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 400])
      const winner = attempts.find((attempt) => attempt.status === 200)
      expect(winner?.body.sudoToken).toBeTruthy()

      const replay = await verify()
      expect(replay.status, 'a consumed sudo session should reject later replay').toBe(400)
      expect(replay.body.sudoToken).toBeUndefined()

      const stored = await readSudoSession(sessionId)
      expect(stored?.verifiedAt).toBeInstanceOf(Date)
      expect(stored?.sessionToken).toBe(winner?.body.sudoToken)
    } finally {
      await deleteSudoFixtures({
        configIds: configId ? [configId] : [],
        sessionIds: sessionId ? [sessionId] : [],
      })
    }
  })
})
