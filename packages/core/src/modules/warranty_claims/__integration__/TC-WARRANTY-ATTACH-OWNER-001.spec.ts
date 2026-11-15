import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hash } from 'bcryptjs'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
  type OwnerAccessActor,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { cancelThenDeleteClaimIfPossible, createClaimFixture, listClaimLines, uniqueLabel } from './helpers'

export const integrationMeta = { dependsOnModules: ['documents', 'warranty_claims', 'ai_assistant'] }

type AssessToolResponse = {
  success?: boolean
  error?: string
  result?: { notConfigured?: boolean; unavailable?: boolean }
}

const NOT_LINKED_ERROR = '[internal] Attachment is not linked to the requested warranty claim target.'

/**
 * TC-WARRANTY-ATTACH-OWNER-001: `warranty_claims.assess_damage_photo`, run
 * through `POST /api/ai_assistant/tools/execute`, checks that the photo is
 * linked to the claim line under the attachment owner policy before it resolves
 * the model. The photo belongs to a document shared with one user and is
 * assigned to the claim line. A regular key with the role and the session key
 * of a user without the share are refused as not linked, while the session key
 * of the user with the share passes the check and stops only at the AI step
 * (no model configured, or no image part for the model). The attachment row is
 * unchanged throughout. Session keys are bound to a known secret the same way
 * as in TC-AI-ATTACHMENT-OWNER-006.
 */
test('TC-WARRANTY-ATTACH-OWNER-001: damage photo tool evaluates the claim link with the key principal', async ({ request }) => {
  test.slow()
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view', 'warranty_claims.claim.view', 'warranty_claims.claim.manage'],
    })
    const { tenantId } = getTokenContext(fixture.admin)
    const stamp = uniqueLabel('tc-warranty-attach-owner-001')
    const sessionUsers: string[] = []
    let claimId: string | null = null

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

    try {
      const claim = await createClaimFixture(request, fixture.admin, {
        claimType: 'warranty',
        customerName: `QA Warranty Owner ${stamp}`,
        reasonCode: 'defective',
        lines: [{ lineNo: 1, productName: `QA Warranty Owner part ${stamp}`, qtyClaimed: 1 }],
      })
      claimId = expectId(claim.id, 'claim fixture must include id')
      const [line] = await listClaimLines(request, fixture.admin, claimId)
      const lineId = expectId(line?.id, 'claim fixture must include a line')

      const document = await fixture.document('warranty')
      await fixture.share(document, 'viewer')
      const file = await fixture.upload(document, 'warranty-photo', {
        assignments: [{ type: 'warranty_claims:warranty_claim_line', id: lineId }],
      })
      const before = await readAttachmentRowInDb(file)
      expect(before).not.toBeNull()

      const assess = (secret: string) => ownerPolicyRequest<AssessToolResponse>(
        'POST', '/api/ai_assistant/tools/execute', secret,
        { toolName: 'warranty_claims.assess_damage_photo', args: { claimId, lineId, attachmentId: file } }, 'ApiKey',
      )

      const recipientSession = await sessionSecret(fixture.recipient)
      const unsharedSession = await sessionSecret(fixture.unshared)
      const regularKey = await fixture.key()

      const regular = await assess(regularKey.secret)
      expect(regular.status, 'a regular key with the same role has no user share').toBe(400)
      expect(regular.body).toEqual({ success: false, error: NOT_LINKED_ERROR })
      expect(await readAttachmentRowInDb(file)).toEqual(before)

      const unshared = await assess(unsharedSession)
      expect(unshared.status, 'the session key of a user without the share is refused').toBe(400)
      expect(unshared.body).toEqual({ success: false, error: NOT_LINKED_ERROR })
      expect(await readAttachmentRowInDb(file)).toEqual(before)

      const allowed = await assess(recipientSession)
      expect(allowed.status, `the session key keeps its user share: ${JSON.stringify(allowed.body)}`).toBe(200)
      expect(allowed.body?.success).toBe(true)
      expect([{ notConfigured: true }, { unavailable: true }]).toContainEqual(allowed.body?.result)
      expect(await readAttachmentRowInDb(file)).toEqual(before)
    } finally {
      if (sessionUsers.length > 0) {
        await withClient((client) => client.query(
          'delete from api_keys where session_user_id = any($1::uuid[]) and tenant_id = $2', [sessionUsers, tenantId],
        ))
      }
      await cancelThenDeleteClaimIfPossible(request, fixture.admin, claimId)
    }
  })
})
