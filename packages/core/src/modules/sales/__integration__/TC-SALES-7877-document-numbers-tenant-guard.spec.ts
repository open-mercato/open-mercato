import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type CreateResponse = { id?: string }
type NumberResponse = { number?: string; format?: string; sequence?: number; error?: string }

function appBaseUrl(): string {
  const baseUrl = new URL(process.env.BASE_URL || 'http://localhost:3000')
  if (baseUrl.hostname === '127.0.0.1') baseUrl.hostname = 'localhost'
  return baseUrl.origin
}

function scopeCookie(tenantId: string | null, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId ?? '')}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(`${appBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Cookie: options.cookie,
      'Content-Type': 'application/json',
      Origin: appBaseUrl(),
    },
    data: options.data,
  })
}

// Over the dispatcher's default `OM_API_TENANT_EXTRACT_MAX_BYTES` (64KB) tenant-extraction
// budget, so the central dispatcher's own body peek gives up on this unflagged route and the
// handler is the only remaining line of defense (issue #7877).
const OVERSIZED_PADDING = 'x'.repeat(90_000)

/**
 * TC-SALES-7877: the dispatcher's tenant-extraction budget is not a tenant-isolation gate by
 * itself for routes that don't set `honorsBodyTenantId` — `withScopedPayload` is. This drives
 * a real over-budget request through the actual `/api/sales/document-numbers` endpoint (no
 * dispatcher/handler mocking) to prove a non-superadmin actor cannot pad their way into a
 * foreign tenant's document-number sequence, while the legitimate own-tenant and
 * missing-feature paths keep working.
 */
test.describe('TC-SALES-7877: document-numbers tenant guard through the real dispatcher', () => {
  test('rejects an over-budget foreign-tenant body without advancing the foreign sequence', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const actorScope = getTokenContext(adminToken)
    const stamp = Date.now()

    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null

    try {
      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `QA SALES 7877 Restricted ${stamp}`, tenantId: actorScope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId, features: ['sales.orders.manage'],
      })
      const restrictedEmail = `qa-sales-7877-${stamp}@example.test`
      const restrictedPassword = `Guard7877!${stamp}`
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail, password: restrictedPassword, organizationId: actorScope.organizationId, roles: [restrictedRoleId],
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, restrictedPassword)
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA SALES 7877 Tenant ${stamp}` },
      })
      expect(tenantResponse.status(), 'tenant fixture should be created').toBe(201)
      foreignTenantId = expectId(
        (await readJsonSafe<CreateResponse>(tenantResponse))?.id,
        'tenant create response should contain an id',
      )
      expect(foreignTenantId).not.toBe(actorScope.tenantId)

      const organizationResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: foreignTenantId, name: `QA SALES 7877 Organization ${stamp}` },
      })
      expect(organizationResponse.status(), 'organization fixture should be created').toBe(201)
      foreignOrganizationId = expectId(
        (await readJsonSafe<CreateResponse>(organizationResponse))?.id,
        'organization create response should contain an id',
      )

      const foreignScopeCookie = scopeCookie(foreignTenantId, foreignOrganizationId)

      // Baseline: the foreign tenant's own legitimate sequence position, read as the
      // superadmin acting *in* that tenant.
      const baselineResponse = await scopedRequest(request, 'POST', '/api/sales/document-numbers', {
        token: superadminToken,
        cookie: foreignScopeCookie,
        data: { kind: 'order', tenantId: foreignTenantId, organizationId: foreignOrganizationId },
      })
      expect(baselineResponse.ok(), 'foreign tenant should generate its own baseline number').toBeTruthy()
      const baselineBody = await readJsonSafe<NumberResponse>(baselineResponse)
      expect(typeof baselineBody?.sequence).toBe('number')
      const baselineSequence = baselineBody!.sequence as number

      // Attack: a non-superadmin actor from a different tenant pads the body past the
      // dispatcher's own tenant-extraction budget and carries the foreign tenant's id.
      const attackResponse = await apiRequest(request, 'POST', '/api/sales/document-numbers', {
        token: adminToken,
        data: {
          kind: 'order',
          tenantId: foreignTenantId,
          organizationId: foreignOrganizationId,
          padding: OVERSIZED_PADDING,
        },
      })
      expect(attackResponse.status(), 'an over-budget foreign-tenant body must still be rejected').toBe(403)
      const attackBody = await readJsonSafe<NumberResponse>(attackResponse)
      expect(attackBody?.error).toBe('You are not allowed to target this tenant.')
      expect(attackBody?.number, 'a rejected request must never return a generated number').toBeUndefined()

      // Verify: the foreign tenant's own next number continues right after the baseline —
      // proving the rejected attack never consumed a value from its sequence.
      const verifyResponse = await scopedRequest(request, 'POST', '/api/sales/document-numbers', {
        token: superadminToken,
        cookie: foreignScopeCookie,
        data: { kind: 'order', tenantId: foreignTenantId, organizationId: foreignOrganizationId },
      })
      expect(verifyResponse.ok(), 'foreign tenant sequence should remain usable after the rejected attack').toBeTruthy()
      const verifyBody = await readJsonSafe<NumberResponse>(verifyResponse)
      expect(verifyBody?.sequence, 'the foreign sequence must advance by exactly one, not two').toBe(
        baselineSequence + 1,
      )

      // Control: the same actor, same over-budget body, targeting their OWN tenant — the
      // legitimate path the security fix must not break.
      const ownTenantResponse = await apiRequest(request, 'POST', '/api/sales/document-numbers', {
        token: adminToken,
        data: {
          kind: 'order',
          tenantId: actorScope.tenantId,
          organizationId: actorScope.organizationId,
          padding: OVERSIZED_PADDING,
        },
      })
      expect(ownTenantResponse.ok(), 'an over-budget own-tenant body should still succeed').toBeTruthy()
      const ownTenantBody = await readJsonSafe<NumberResponse>(ownTenantResponse)
      expect(typeof ownTenantBody?.number).toBe('string')

      // Control: an actor missing `sales.documents.number.edit` is denied regardless of body
      // size or tenant targeting — a different gate than the one under test here.
      const missingFeatureResponse = await apiRequest(request, 'POST', '/api/sales/document-numbers', {
        token: restrictedToken,
        data: { kind: 'order', tenantId: actorScope.tenantId, organizationId: actorScope.organizationId },
      })
      expect(missingFeatureResponse.status(), 'missing sales.documents.number.edit must deny').toBe(403)
    } finally {
      if (foreignTenantId && foreignOrganizationId) {
        await withClient(async (client) => {
          const removedSequences = await client.query<{ id: string }>(
            'delete from sales_document_sequences where tenant_id = $1 and organization_id = $2 returning id',
            [foreignTenantId, foreignOrganizationId],
          )
          for (const sequence of removedSequences.rows) {
            const sequenceName = `sales_docseq_${sequence.id.replace(/-/g, '').toLowerCase()}`
            expect(sequenceName).toMatch(/^sales_docseq_[0-9a-f]{32}$/)
            await client.query(`drop sequence if exists "${sequenceName}"`)
          }
        })
      }
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/organizations',
        foreignOrganizationId,
      )
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
      await deleteUserIfExists(request, superadminToken, restrictedUserId)
      await deleteRoleIfExists(request, superadminToken, restrictedRoleId)
    }
  })
})
