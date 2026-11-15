import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hash } from 'bcryptjs'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OWNER_ACCESS_FEATURES,
  OWNER_ACCESS_PNG,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
  type AttachmentRowSnapshot,
  type OwnerAccessActor,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  deleteFakeLlmUsageInDb,
  startFakeLlmServer,
  withFakeLlmEnvironment,
  type FakeLlmServer,
} from '@open-mercato/ai-assistant/modules/ai_assistant/__integration__/helpers/fakeLlmServer'
import { cancelThenDeleteClaimIfPossible, createClaimFixture, listClaimLines, uniqueLabel } from './helpers'

export const integrationMeta = { dependsOnModules: ['documents', 'warranty_claims', 'ai_assistant'] }

const DAMAGE_ASSESSMENT = {
  damageType: 'crack',
  severity: 'minor',
  probableCause: 'impact',
  misuseSuspected: false,
  confidence: 0.5,
  summary: 'Fake assessment',
}
const NOT_LINKED_ERROR = /not linked to this claim/

type AssessBody = { status?: string; assessment?: unknown; error?: string }
type AssessCall = { status: number; body: AssessBody }
type AssessPost = (request: Request) => Promise<Response>

async function loadAssessRoute(): Promise<AssessPost> {
  const { installNextSubpathResolveHook } = await importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook')>('@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook')
  installNextSubpathResolveHook()
  const [{ bootstrapFromAppRoot }, route] = await Promise.all([
    importFromAppRuntime<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')>('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
    importFromAppRuntime<typeof import('@open-mercato/core/modules/warranty_claims/api/ai/assess/route')>('@open-mercato/core/modules/warranty_claims/api/ai/assess/route'),
  ])
  await bootstrapFromAppRoot(resolveAppRoot())
  return route.POST
}

/**
 * TC-WARRANTY-ATTACH-OWNER-002: `POST /api/warranty_claims/ai/assess` runs
 * in-process against the app's database with the model provider pointed at a
 * local OpenAI-compatible fake that records every request. A PNG belongs to a
 * document shared with one user and is assigned to the claim line. A regular key
 * of the role passes the route's claim-link check (evaluated with the request's
 * own auth, whose creator owns the document), but the attachment-part read is
 * evaluated as the key, so the route answers `aiUnavailable` and the model is
 * never called. Once the document is shared with the key's role, the same key
 * sends the image. The session key and the bearer token of the user with the
 * share send the image; the session key of a user without the share and copies
 * of the PNG in another organization and in another tenant are refused as not
 * linked before any model call. The attachment rows are unchanged throughout.
 * Only the bearer call is followed past the model call: saving a key-authenticated
 * assessment records the key subject as the claim event actor, which the event
 * table rejects, so for keys the evidence is the request the model received.
 */
test('TC-WARRANTY-ATTACH-OWNER-002: assess route sends the claim photo to the model only for principals that may read it', async ({ request }) => {
  test.slow()
  const llm: FakeLlmServer = await startFakeLlmServer({ object: () => DAMAGE_ASSESSMENT })
  try {
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view', 'warranty_claims.claim.view', 'warranty_claims.claim.manage'],
      })
      const { tenantId } = getTokenContext(fixture.admin)
      const stamp = uniqueLabel('tc-warranty-attach-owner-002')
      const sessionUsers: string[] = []
      let claimId: string | null = null
      let photoId: string | null = null

      const sessionSecret = async (actor: OwnerAccessActor): Promise<string> => {
        const issued = await apiRequest(request, 'POST', '/api/ai_assistant/session-key', {
          token: await actor.refreshToken(), data: {},
        })
        expect(issued.status()).toBe(200)
        const body = await readJsonSafe<{ sessionToken?: string }>(issued)
        expect(body?.sessionToken).toMatch(/^sess_[a-f0-9]{32}$/)
        sessionUsers.push(actor.id)
        const secret = `omk_${randomBytes(4).toString('hex')}.${randomBytes(24).toString('hex')}`
        const bound = await withClient(async (client) => client.query<{ id: string }>(
          'update api_keys set key_hash = $1, key_prefix = $2 where session_token_hash = $3 and session_user_id = $4 and tenant_id = $5 returning id',
          [await hash(secret, 10), secret.slice(0, 12), createHash('sha256').update(body!.sessionToken!).digest('hex'), actor.id, tenantId],
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

        const document = await fixture.document('warranty-photo')
        await fixture.share(document, 'viewer')
        const photo = await uploadAttachmentFixture(request, fixture.admin, {
          entityId: 'documents:document', recordId: document,
          fileName: `${fixture.prefix}-damage.png`, mimeType: 'image/png', buffer: OWNER_ACCESS_PNG,
          assignments: [{ type: 'warranty_claims:warranty_claim_line', id: lineId }],
        })
        photoId = photo.id
        const foreign = [
          await fixture.foreignCopy(photo.id, 'organization', { recordId: document }),
          await fixture.foreignCopy(photo.id, 'tenant', { recordId: document }),
        ].map((row) => row.id)
        const tracked = [photo.id, ...foreign]
        const before = new Map<string, AttachmentRowSnapshot | null>()
        for (const id of tracked) before.set(id, await readAttachmentRowInDb(id))

        const recipientSession = await sessionSecret(fixture.recipient)
        const unsharedSession = await sessionSecret(fixture.unshared)
        const regularKey = await fixture.key()
        const photoBase64 = OWNER_ACCESS_PNG.toString('base64')
        const post = await loadAssessRoute()
        const origin = process.env.BASE_URL?.trim() || 'http://localhost:3000'

        const assess = async (credential: string, scheme: 'Bearer' | 'ApiKey', attachmentId = photo.id): Promise<AssessCall> => {
          llm.reset()
          const response = await post(new Request(new URL('/api/warranty_claims/ai/assess', origin), {
            method: 'POST',
            headers: { Authorization: `${scheme} ${credential}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ claimId, lineId, attachmentId, kind: 'damage' }),
          }))
          return { status: response.status, body: await response.json() as AssessBody }
        }
        const modelRequests = () => llm.requests.filter((entry) => entry.path.endsWith('/chat/completions'))
        const expectImageSent = (call: AssessCall, principal: string) => {
          expect(call.status, `${principal}: ${JSON.stringify(call.body)}`).toBe(200)
          expect(call.body, `${principal}: ${llm.requests.length} model request(s)`).toEqual({ status: 'ok', assessment: DAMAGE_ASSESSMENT })
          expect(modelRequests(), `${principal}: one model call`).toHaveLength(1)
          expect(modelRequests()[0].raw, `${principal}: the model receives the photo`).toContain(photoBase64)
        }
        const expectImageReachedModel = (principal: string) => {
          expect(modelRequests(), `${principal}: one model call`).toHaveLength(1)
          expect(modelRequests()[0].raw, `${principal}: the model receives the photo`).toContain(photoBase64)
        }
        const expectNoModelCall = (principal: string) => {
          expect(llm.requests, `${principal}: the model is never called`).toHaveLength(0)
        }

        try {
          await withFakeLlmEnvironment(llm, async () => {
            const regular = await assess(regularKey.secret, 'ApiKey')
            expect(regular.status, `regular key: ${JSON.stringify(regular.body)}`).toBe(200)
            expect(regular.body, 'the link check passes, the key cannot read the photo').toEqual({ status: 'aiUnavailable' })
            expectNoModelCall('regular key')

            const unshared = await assess(unsharedSession, 'ApiKey')
            expect(unshared.status).toBe(400)
            expect(unshared.body.error).toMatch(NOT_LINKED_ERROR)
            expectNoModelCall('session key without the share')

            for (const foreignId of foreign) {
              const outOfScope = await assess(recipientSession, 'ApiKey', foreignId)
              expect(outOfScope.status, `foreign copy ${foreignId}`).toBe(400)
              expect(outOfScope.body.error).toMatch(NOT_LINKED_ERROR)
              expectNoModelCall(`foreign copy ${foreignId}`)
            }

            await assess(recipientSession, 'ApiKey')
            expectImageReachedModel('session key with the share')
            expectImageSent(await assess(await fixture.recipient.refreshToken(), 'Bearer'), 'bearer token with the share')

            await fixture.share(document, 'viewer', 'role', fixture.roleId)
            await assess(regularKey.secret, 'ApiKey')
            expectImageReachedModel('regular key once its role has the share')
          })
        } finally {
          await deleteFakeLlmUsageInDb()
        }
        for (const id of tracked) expect(await readAttachmentRowInDb(id), `row ${id} is unchanged`).toEqual(before.get(id))
      } finally {
        if (sessionUsers.length > 0) {
          await withClient((client) => client.query(
            'delete from api_keys where session_user_id = any($1::uuid[]) and tenant_id = $2', [sessionUsers, tenantId],
          ))
        }
        await deleteAttachmentIfExists(request, fixture.admin, photoId)
        await cancelThenDeleteClaimIfPossible(request, fixture.admin, claimId)
      }
    })
  } finally {
    await llm.close()
  }
})
