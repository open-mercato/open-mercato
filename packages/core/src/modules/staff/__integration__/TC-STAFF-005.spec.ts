import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = {
  dependsOnModules: ['staff'],
}

function decodeJwtSub(token: string): string {
  const [, payload = ''] = token.split('.')
  const decoded = Buffer.from(payload, 'base64url').toString('utf8')
  const parsed = JSON.parse(decoded) as { sub?: string }
  if (typeof parsed.sub !== 'string' || parsed.sub.length === 0) {
    throw new Error('JWT subject is missing')
  }
  return parsed.sub
}

test.describe('TC-STAFF-005: Assignable team-members route (staff-owned)', () => {
  test('responds at the new staff URL with paging metadata and serves a 308 redirect from the legacy customers URL', async ({ request }) => {
    const stamp = Date.now()
    const memberName = `QA Staff Assignable ${stamp}`

    let adminToken: string | null = null
    let employeeToken: string | null = null
    let memberId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      employeeToken = await getAuthToken(request, 'employee')

      const adminUserId = decodeJwtSub(adminToken)

      const createResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token: adminToken,
        data: {
          displayName: memberName,
          userId: adminUserId,
          isActive: true,
        },
      })
      expect(
        createResponse.ok(),
        `team member fixture should be created: ${createResponse.status()}`,
      ).toBeTruthy()
      const createBody = (await createResponse.json()) as { id?: string | null }
      memberId = typeof createBody.id === 'string' ? createBody.id : null
      expect(memberId).toBeTruthy()

      const newRouteResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/team-members/assignable?pageSize=20&page=1&search=${encodeURIComponent(memberName)}`,
        { token: employeeToken },
      )
      expect(
        newRouteResponse.ok(),
        `new staff route should succeed: ${newRouteResponse.status()}`,
      ).toBeTruthy()
      const newRouteBody = (await newRouteResponse.json()) as {
        items?: Array<{ displayName?: string; userId?: string }>
        total?: number
        page?: number
        pageSize?: number
      }
      expect(Array.isArray(newRouteBody.items)).toBeTruthy()
      expect(typeof newRouteBody.total).toBe('number')
      expect(newRouteBody.page).toBe(1)
      expect(newRouteBody.pageSize).toBe(20)
      expect(newRouteBody.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ displayName: memberName, userId: adminUserId }),
        ]),
      )

      const legacyRedirect = await request.fetch(
        `/api/customers/assignable-staff?pageSize=20&page=1&search=${encodeURIComponent(memberName)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${employeeToken}` },
          maxRedirects: 0,
        },
      )
      expect(
        legacyRedirect.status(),
        `legacy URL should respond with 308: ${legacyRedirect.status()}`,
      ).toBe(308)
      const location = legacyRedirect.headers()['location']
      expect(location, 'redirect Location header missing').toBeTruthy()
      const target = new URL(location as string, 'http://localhost')
      expect(target.pathname).toBe('/api/staff/team-members/assignable')
      expect(target.search).toBe(`?pageSize=20&page=1&search=${encodeURIComponent(memberName)}`)
    } finally {
      if (adminToken && memberId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/staff/team-members?id=${encodeURIComponent(memberId)}`,
          { token: adminToken },
        ).catch(() => {})
      }
    }
  })
})
