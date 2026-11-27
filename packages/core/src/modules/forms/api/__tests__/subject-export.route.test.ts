import { NextRequest } from 'next/server'
import { GET } from '../subjects/[subjectType]/[subjectId]/export/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'staff', tenantId: 'tenant', orgId: 'org' })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: () => ({ exportSubject: async () => ({ document: {}, submissionIds: [] }) }),
  })),
}))

it('emits a safe filename for a subject type containing filename punctuation', async () => {
  const subjectId = 'bc24adf9-c445-4f07-8c4f-079bab6b3950'
  const response = await GET(new NextRequest('https://app.example.test/export'), {
    params: { subjectId, subjectType: 'customer:person' },
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('content-disposition')).toBe(
    `attachment; filename="forms-export-customer_person-${subjectId}.json"`,
  )
})
