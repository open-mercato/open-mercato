import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityByBody,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

type AccessLogItem = {
  id: string
  resourceKind: string
  resourceId: string
  accessType: string
  context: Record<string, unknown> | null
}

type AccessLogResponse = {
  items: AccessLogItem[]
}

test.describe('TC-AUD-010: durable access context and export', () => {
  test('records request metadata before response and exports the same scoped row', async ({ request }) => {
    const stamp = Date.now()
    const requestId = `qa-aud-010-${stamp}`
    let token: string | null = null
    let companyId: string | null = null
    let accessLogId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-AUD-010 ${stamp}`)

      const readResponse = await request.get(`/api/customers/companies?id=${companyId}&page=1&pageSize=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-request-id': requestId,
          'user-agent': 'OpenMercato integration test',
        },
      })
      expect(readResponse.status(), 'audited CRUD read returns 200').toBe(200)

      const accessResponse = await request.get(
        '/api/audit_logs/audit-logs/access?resourceKind=customers.company&pageSize=200',
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(accessResponse.status(), 'access-log list returns 200').toBe(200)
      const accessBody = (await accessResponse.json()) as AccessLogResponse
      const entry = accessBody.items.find((item) =>
        item.resourceId === companyId && item.context?.requestId === requestId,
      )

      expect(entry, 'the CRUD response has a durable access-log row').toBeDefined()
      accessLogId = entry?.id ?? null
      expect(entry?.accessType).toMatch(/^read/)
      expect(entry?.context).toEqual(expect.objectContaining({
        method: 'GET',
        operation: expect.stringMatching(/^read/),
        path: '/api/customers/companies',
        requestId,
        result: 'success',
        statusCode: 200,
        userAgent: 'OpenMercato integration test',
      }))
      expect(typeof entry?.context?.sessionId, 'session identifier is present').toBe('string')

      const exportResponse = await request.get(
        '/api/audit_logs/audit-logs/access/export?resourceKind=customers.company&limit=1000',
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(exportResponse.status(), 'access export returns 200').toBe(200)
      expect(exportResponse.headers()['content-type'] ?? '', 'access export is CSV').toContain('csv')
      const csv = await exportResponse.text()
      expect(csv, 'CSV contains the correlated request').toContain(requestId)
      expect(csv, 'CSV contains the accessed entity id').toContain(companyId)
    } finally {
      await deleteEntityByBody(request, token, '/api/customers/companies', companyId)
      if (accessLogId) {
        await withClient(async (client) => {
          await client.query('delete from access_logs where id = $1', [accessLogId])
        }).catch(() => undefined)
      }
    }
  })
})
