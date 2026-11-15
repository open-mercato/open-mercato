import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { cancelThenDeleteClaimIfPossible, createClaimFixture } from './helpers'

const portalBase = '/api/warranty_claims/portal'

for (const role of ['viewer', 'restricted', 'buyer'] as const) {
  test(`TC-WC-9110: ${role} portal permissions cover every warranty endpoint`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const companyId = await createCustomerCompanyFixture(request, token)
    let roleId: string | null = null
    let userId: string | null = null
    const claimIds: string[] = []
    try {
      const features = role === 'restricted' ? ['portal.account.manage'] : [
        'portal.account.manage', 'portal.orders.view', 'portal.warranty_claims.view',
        ...(role === 'buyer' ? ['portal.warranty_claims.manage'] : []),
      ]
      roleId = (await createCustomerRoleFixture(request, token, { features })).id
      const user = await createCustomerUserFixture(request, token, { customerEntityId: companyId, roleIds: [roleId] })
      userId = user.id
      const headers = portalCookieHeaders(await portalLogin(request, { ...user, tenantId }))
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty', customerId: companyId, reasonCode: 'defective',
        lines: [{ lineNo: 1, faultDescription: 'Issue 9110 authorization fixture', qtyClaimed: 1 }],
      })
      const claimId = claim.id!
      claimIds.push(claimId)
      const readPaths = [
        '/claims', `/claims/${claimId}`, `/events?claimId=${claimId}`,
        `/attachments?claimId=${claimId}`, '/options', '/troubleshooting', '/orders',
      ]
      for (const path of readPaths) {
        expect((await request.get(`${portalBase}${path}`, { headers })).status(), `${role} GET ${path}`).toBe(role === 'restricted' ? 403 : 200)
      }
      const orderLines = await request.get(`${portalBase}/orders/lines?orderId=${randomUUID()}`, { headers })
      expect(orderLines.status()).toBe(role === 'restricted' ? 403 : 404)
      const attachmentId = randomUUID()
      const writes = [
        { method: 'POST', path: '/claims', data: {} },
        { method: 'POST', path: `/claims/${claimId}/submit`, data: {} },
        { method: 'POST', path: `/claims/${claimId}/withdraw`, data: {} },
        { method: 'POST', path: '/events', data: {} },
        { method: 'POST', path: '/attachments', data: {} },
        { method: 'PUT', path: '/attachments', data: {} },
        { method: 'DELETE', path: `/attachments?attachmentId=${attachmentId}`, data: {} },
      ]
      if (role !== 'buyer') {
        for (const write of writes) {
          expect((await request.fetch(`${portalBase}${write.path}`, { method: write.method, data: write.data, headers })).status(), `${role} ${write.method} ${write.path}`).toBe(403)
        }
        const detail = await request.get(`/api/warranty_claims?id=${claimId}`, { headers: { Authorization: `Bearer ${token}` } })
        const body = await readJsonSafe<{ items: Array<{ status: string }> }>(detail)
        expect(body?.items[0]?.status).toBe('draft')
      } else {
        const intake = await request.post(`${portalBase}/claims`, {
          headers,
          data: { reasonCode: 'defective', lines: [{ faultDescription: 'Buyer still submits', qtyClaimed: 1 }] },
        })
        expect(intake.status()).toBe(201)
        const created = await readJsonSafe<{ claimId: string }>(intake)
        expect(created?.claimId).toBeTruthy()
        claimIds.push(created!.claimId)
        const createdDetail = await request.get(`${portalBase}/claims/${created!.claimId}`, { headers })
        expect((await readJsonSafe<{ item: { status: string } }>(createdDetail))?.item.status).toBe('submitted')
        expect((await request.post(`${portalBase}/claims/${claimId}/submit`, { headers })).status()).toBe(200)
        expect((await request.post(`${portalBase}/claims/${claimId}/withdraw`, { headers })).status()).toBe(200)
      }
    } finally {
      for (const claimId of claimIds.reverse()) await cancelThenDeleteClaimIfPossible(request, token, claimId)
      if (userId) await deleteCustomerUserFixture(request, token, userId)
      if (roleId) await deleteCustomerRoleFixture(request, token, roleId)
      await deleteCustomerCompanyFixture(request, token, companyId)
    }
  })
}
