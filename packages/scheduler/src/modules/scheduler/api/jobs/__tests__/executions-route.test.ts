import { NextRequest } from 'next/server'

const userId = '33333333-3333-4333-8333-333333333333'
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const findOneMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return { findOne: findOneMock }
      return {}
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: userId, tenantId, orgId: organizationId }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`,
  }),
}))

import { GET } from '../[id]/executions/route'

function request(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/scheduler/jobs/${id}/executions`)
}

describe('GET /api/scheduler/jobs/[id]/executions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneMock.mockImplementation(async (_entity: unknown, where: { id: string }) => {
      if (!guidPattern.test(where.id)) {
        throw new Error(`invalid input syntax for type uuid: "${where.id}"`)
      }
      return null
    })
  })

  it('answers a translated 400 for a malformed schedule id without querying the database', async () => {
    const response = await GET(request('not-a-uuid'), { params: { id: 'not-a-uuid' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('t:scheduler.error.invalid_id:Invalid schedule id')
    expect(body.error).not.toMatch(/invalid input syntax/i)
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it.each([
    ['an RFC 4122 schedule id', '44444444-4444-4444-8444-444444444444'],
    ['a module-registered schedule id without RFC 4122 version/variant bits', 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6'],
  ])('still looks up %s', async (_label, scheduleId) => {
    const response = await GET(request(scheduleId), { params: { id: scheduleId } })

    expect(response.status).toBe(404)
    expect(findOneMock).toHaveBeenCalledWith(expect.anything(), { id: scheduleId, deletedAt: null })
  })
})
