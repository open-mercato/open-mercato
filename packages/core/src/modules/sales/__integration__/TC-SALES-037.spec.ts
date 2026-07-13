import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-037: RBAC / feature gating on sales document queries.
 *
 * Issue #2459 scenario "TC-SALES-036 — RBAC and Tenant Scoping in Sales Document Queries" (P0).
 * Renumbered to 037: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * Verifies the sales feature gates are enforced:
 *  - unauthenticated requests are rejected (401);
 *  - a role with `sales.settings.view` but not `sales.settings.manage` gets 403 on tax-rate access;
 *  - a role granted only `sales.orders.view` can list orders but cannot create them
 *    (`sales.orders.manage` is required for writes) — the view/manage split.
 * Limited subjects are built via API fixtures and cleaned up in `finally`.
 */

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function requiredFeatures(body: JsonRecord): string[] {
  return Array.isArray(body.requiredFeatures) ? (body.requiredFeatures as string[]) : []
}

test.describe('TC-SALES-037 sales RBAC / feature gating', () => {
  test('rejects unauthenticated and malformed-token requests', async ({ request }) => {
    const noToken = await apiRequest(request, 'GET', '/api/sales/orders', { token: '' })
    expect(noToken.status(), 'missing bearer token should be 401').toBe(401)

    const badToken = await apiRequest(request, 'GET', '/api/sales/orders', { token: 'not-a-valid-jwt' })
    expect(badToken.status(), 'malformed token should be 401').toBe(401)
  })

  test('settings-view-only role without sales.settings.manage cannot read or write tax rates', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const email = `qa-sales-settings-viewer-${stamp}@acme.com`
    const password = `QaSettings1!${stamp}`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `QA Sales Settings Viewer ${stamp}`,
        tenantId: scope.tenantId ?? undefined,
      })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['sales.settings.view'] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId!,
        roles: [roleId],
        name: `QA Sales Settings Viewer ${stamp}`,
      })

      const token = await getAuthToken(request, email, password)

      const list = await apiRequest(request, 'GET', '/api/sales/tax-rates', { token })
      expect(list.status(), 'settings-view-only GET /api/sales/tax-rates should be 403').toBe(403)
      expect(requiredFeatures(await readJson(list)), '403 should cite the gating feature').toContain('sales.settings.manage')

      const create = await apiRequest(request, 'POST', '/api/sales/tax-rates', {
        token,
        data: { name: 'QA blocked', code: `qa-blocked-${Date.now()}`, rate: 5 },
      })
      expect(create.status(), 'settings-view-only POST /api/sales/tax-rates should be 403').toBe(403)
      expect(requiredFeatures(await readJson(create)), '403 should cite the gating feature').toContain('sales.settings.manage')
    } finally {
      if (adminToken && userId) await deleteUserIfExists(request, adminToken, userId)
      if (adminToken && roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a view-only role can list orders but cannot create them', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const email = `qa-sales-viewer-${stamp}@acme.com`
    const password = `QaView1!${stamp}`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `QA Sales Viewer ${stamp}`,
        tenantId: scope.tenantId ?? undefined,
      })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['sales.orders.view'] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId!,
        roles: [roleId],
        name: `QA Sales Viewer ${stamp}`,
      })

      const viewerToken = await getAuthToken(request, email, password)

      const listResponse = await apiRequest(request, 'GET', '/api/sales/orders', { token: viewerToken })
      expect(listResponse.status(), 'view-only role GET /api/sales/orders should be 200').toBe(200)
      const listBody = await readJson(listResponse)
      expect(Array.isArray(listBody.items), 'list response should be paginated').toBeTruthy()

      const createResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token: viewerToken,
        data: { currencyCode: 'USD' },
      })
      expect(createResponse.status(), 'view-only role POST /api/sales/orders should be 403').toBe(403)
      expect(requiredFeatures(await readJson(createResponse)), '403 should require the manage feature').toContain('sales.orders.manage')
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a role with no sales features cannot access sales notes', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const email = `qa-sales-notes-denied-${stamp}@acme.com`
    const password = `QaNotesDenied1!${stamp}`
    let roleId: string | null = null
    let userId: string | null = null
    let orderId: string | null = null
    let noteId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, adminToken)
      const createNote = await apiRequest(request, 'POST', '/api/sales/notes', {
        token: adminToken,
        data: {
          contextType: 'order',
          contextId: orderId,
          body: `QA sales note ACL ${stamp}`,
        },
      })
      expect(createNote.status(), 'admin should create fixture sales note').toBe(201)
      noteId = String(((await readJson(createNote)) as { id?: unknown }).id ?? '')
      expect(noteId, 'fixture note id should be returned').toBeTruthy()

      roleId = await createRoleFixture(request, adminToken, {
        name: `QA Sales Notes Denied ${stamp}`,
        tenantId: scope.tenantId ?? undefined,
      })
      await setRoleAclFeatures(request, adminToken, { roleId, features: [] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId!,
        roles: [roleId],
        name: `QA Sales Notes Denied ${stamp}`,
      })

      const deniedToken = await getAuthToken(request, email, password)

      const list = await apiRequest(
        request,
        'GET',
        `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}`,
        { token: deniedToken },
      )
      expect(list.status(), 'zero-sales role GET /api/sales/notes should be 403').toBe(403)
      expect(requiredFeatures(await readJson(list)), '403 should cite order view').toContain('sales.orders.view')

      const create = await apiRequest(request, 'POST', '/api/sales/notes', {
        token: deniedToken,
        data: {
          contextType: 'order',
          contextId: orderId,
          body: `QA blocked note ${stamp}`,
        },
      })
      expect(create.status(), 'zero-sales role POST /api/sales/notes should be 403').toBe(403)
      expect(requiredFeatures(await readJson(create)), '403 should cite order manage').toContain('sales.orders.manage')

      const update = await apiRequest(request, 'PUT', '/api/sales/notes', {
        token: deniedToken,
        data: { id: noteId, body: `QA blocked note update ${stamp}` },
      })
      expect(update.status(), 'zero-sales role PUT /api/sales/notes should be 403').toBe(403)
      expect(requiredFeatures(await readJson(update)), '403 should cite order manage').toContain('sales.orders.manage')

      const del = await apiRequest(
        request,
        'DELETE',
        `/api/sales/notes?id=${encodeURIComponent(noteId)}`,
        { token: deniedToken },
      )
      expect(del.status(), 'zero-sales role DELETE /api/sales/notes should be 403').toBe(403)
      expect(requiredFeatures(await readJson(del)), '403 should cite order manage').toContain('sales.orders.manage')
    } finally {
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/notes', noteId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
