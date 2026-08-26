import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  buildSudoScopeCookie,
  createPasswordSudoConfig,
  createSudoTestContext,
  deleteSudoFixtures,
  initiateSudoChallenge,
  readSudoSession,
  verifySudoChallenge,
  type SudoVerifyResponse,
} from './helpers/sudoFixtures'

test.describe('TC-SEC-011: Sudo policy drift', () => {
  test('re-resolves policy under a PostgreSQL table lock after credentials pass', async ({ request }) => {
    const context = await createSudoTestContext(request)
    const targetIdentifier = `security.qa.sudo-policy-drift-${Date.now()}-${randomUUID()}`
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

      const verification: { status: number; body: SudoVerifyResponse } = await withClient(async (writer) => {
        await writer.query('begin')
        try {
          await writer.query(
            `update sudo_challenge_configs
             set ttl_seconds = ttl_seconds + 1,
                 updated_at = updated_at + interval '1 second'
             where id = $1`,
            [configId],
          )
          const verificationPromise = verifySudoChallenge(request, {
            token: context.token,
            sessionId: sessionId as string,
            targetIdentifier,
            password: context.password,
            cookie,
          })

          await expect.poll(async () => withClient(async (observer) => {
            const result = await observer.query<{ waiting: boolean }>(
              `select exists (
                 select 1
                 from pg_stat_activity
                 where pid <> pg_backend_pid()
                   and state = 'active'
                   and position($1 in lower(query)) > 0
               ) as waiting`,
              ['lock table "sudo_challenge_configs" in share mode'],
            )
            return result.rows[0]?.waiting ?? false
          }), {
            message: 'sudo verification should wait on the config table share lock',
          }).toBe(true)

          await writer.query('commit')
          return await verificationPromise
        } catch (error) {
          await writer.query('rollback')
          throw error
        }
      })

      expect(verification?.status, 'a config update committed during verification should invalidate the challenge').toBe(403)
      expect(verification?.body.sudoToken).toBeUndefined()
      const session = await readSudoSession(sessionId)
      expect(session?.verifiedAt, 'policy drift must not consume the pending session').toBeNull()
    } finally {
      await deleteSudoFixtures({
        configIds: configId ? [configId] : [],
        sessionIds: sessionId ? [sessionId] : [],
      })
    }
  })
})
