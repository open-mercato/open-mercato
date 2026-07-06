import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

function decodeJwtSub(token: string): string {
  const [, payload = ''] = token.split('.')
  const decoded = Buffer.from(payload, 'base64url').toString('utf8')
  const parsed = JSON.parse(decoded) as { sub?: string }
  if (typeof parsed.sub !== 'string' || parsed.sub.length === 0) {
    throw new Error('JWT subject is missing')
  }
  return parsed.sub
}

test.describe('TC-CRM-038: Assignable staff lookup for customer flows', () => {
  test('employee can fetch assignable staff candidates through the customers endpoint', async ({
    request,
  }) => {
    const stamp = Date.now()
    const memberName = `QA Assignable Staff ${stamp}`

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

      const lookupResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/team-members/assignable?pageSize=20&search=${encodeURIComponent(memberName)}`,
        { token: employeeToken },
      )
      expect(
        lookupResponse.ok(),
        `assignable staff lookup should succeed: ${lookupResponse.status()}`,
      ).toBeTruthy()
      const lookupBody = (await lookupResponse.json()) as {
        items?: Array<{ displayName?: string; userId?: string }>
      }
      const items = Array.isArray(lookupBody.items) ? lookupBody.items : []

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: memberName,
            userId: adminUserId,
          }),
        ]),
      )
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
