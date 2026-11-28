import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hash } from 'bcryptjs'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  withAttachmentOwnerFixture,
  type OwnerAccessActor,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

type ReadAttachmentResponse = {
  success?: boolean
  result?: { found?: boolean; attachmentId?: string }
}

/**
 * TC-AI-ATTACHMENT-OWNER-006: a session key is evaluated as the key together
 * with the user it acts for. The key is issued by `POST
 * /api/ai_assistant/session-key`; its stored secret never leaves the server, so
 * the spec swaps only the row's key hash for one whose secret it knows (as
 * TC-AI-KEY-ACL-7825 does) and calls `tools/execute` with it. The session key
 * of a user with a user share reads the file, while a regular key with the same
 * role and the session key of a user without the share do not; once the share
 * is revoked, the session key is refused too.
 */
test('TC-AI-ATTACHMENT-OWNER-006: AI attachment tools evaluate a session key with its verified user', async ({ request }) => {
  test.slow()
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const { tenantId } = getTokenContext(fixture.admin)
    const document = await fixture.document('session')
    const userShare = await fixture.share(document, 'viewer')
    const file = await fixture.upload(document, 'session-ai')
    const sessionUsers: string[] = []

    const sessionSecret = async (actor: OwnerAccessActor): Promise<string> => {
      const issued = await apiRequest(request, 'POST', '/api/ai_assistant/session-key', {
        token: await actor.refreshToken(), data: {},
      })
      expect(issued.status()).toBe(200)
      const body = await readJsonSafe<{ sessionToken?: string }>(issued)
      expect(body?.sessionToken).toMatch(/^sess_[a-f0-9]{32}$/)
      sessionUsers.push(actor.id)
      const secret = `omk_${randomBytes(4).toString('hex')}.${randomBytes(24).toString('hex')}`
      const keyHash = await hash(secret, 10)
      const bound = await withClient((client) => client.query<{ id: string }>(
        'update api_keys set key_hash = $1, key_prefix = $2 where session_token_hash = $3 and session_user_id = $4 and tenant_id = $5 returning id',
        [keyHash, secret.slice(0, 12), createHash('sha256').update(body!.sessionToken!).digest('hex'), actor.id, tenantId],
      ))
      expect(bound.rows).toHaveLength(1)
      return secret
    }
    const read = (secret: string) => ownerPolicyRequest<ReadAttachmentResponse>(
      'POST', '/api/ai_assistant/tools/execute', secret,
      { toolName: 'attachments.read_attachment', args: { attachmentId: file } }, 'ApiKey',
    )

    try {
      const recipientSession = await sessionSecret(fixture.recipient)
      const unsharedSession = await sessionSecret(fixture.unshared)
      const regularKey = await fixture.key()

      const allowed = await read(recipientSession)
      expect(allowed.status).toBe(200)
      expect(allowed.body?.result?.found, 'the session key keeps its user share').toBe(true)

      const regular = await read(regularKey.secret)
      expect(regular.status).toBe(200)
      expect(regular.body?.result, 'a regular key with the same role has no user share').toEqual({ found: false, attachmentId: file })

      const unshared = await read(unsharedSession)
      expect(unshared.status).toBe(200)
      expect(unshared.body?.result, 'the session key of a user without the share is refused').toEqual({ found: false, attachmentId: file })

      await fixture.unshare(document, userShare)
      const revoked = await read(recipientSession)
      expect(revoked.status).toBe(200)
      expect(revoked.body?.result, 'the session key loses access with its user').toEqual({ found: false, attachmentId: file })
    } finally {
      if (sessionUsers.length > 0) {
        await withClient((client) => client.query(
          'delete from api_keys where session_user_id = any($1::uuid[]) and tenant_id = $2', [sessionUsers, tenantId],
        ))
      }
    }
  })
})
