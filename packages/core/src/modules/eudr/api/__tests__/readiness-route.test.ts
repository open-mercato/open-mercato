/** @jest-environment node */

import type { NextRequest } from 'next/server'

const mockStatement = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'draft',
  actorRole: null,
  referencedStatements: [],
}
const mockFirstFork = { id: 'first-fork' }
const mockSecondFork = { id: 'second-fork' }
const mockEm = {
  findOne: jest.fn(async () => mockStatement),
  fork: jest.fn(),
}
const mockLoadStatementSubmissionsForGate = jest.fn(async () => [])
const mockLoadLatestAssessmentForGate = jest.fn(async () => null)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    isSuperAdmin: false,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      throw new Error(`[internal] unexpected container key: ${key}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: 'org-1' })),
}))

jest.mock('../../commands/statements', () => ({
  loadStatementSubmissionsForGate: (...args: unknown[]) => mockLoadStatementSubmissionsForGate(...args),
  loadLatestAssessmentForGate: (...args: unknown[]) => mockLoadLatestAssessmentForGate(...args),
}))

import { GET } from '../statements/[id]/readiness/route'

describe('EUDR statement readiness route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork
      .mockReturnValueOnce(mockFirstFork)
      .mockReturnValueOnce(mockSecondFork)
  })

  it('uses an isolated entity manager for each parallel gate lookup', async () => {
    const request = new Request(
      `http://localhost/api/eudr/statements/${mockStatement.id}/readiness`,
    ) as NextRequest
    const response = await GET(request, {
      params: Promise.resolve({ id: mockStatement.id }),
    })

    expect(response.status).toBe(200)
    expect(mockEm.fork).toHaveBeenCalledTimes(2)
    expect(mockLoadStatementSubmissionsForGate).toHaveBeenCalledWith(mockFirstFork, mockStatement)
    expect(mockLoadLatestAssessmentForGate).toHaveBeenCalledWith(mockSecondFork, mockStatement)
  })
})
