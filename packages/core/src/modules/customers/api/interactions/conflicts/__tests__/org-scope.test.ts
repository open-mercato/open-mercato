/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const resolveContainerService = jest.fn()
const container = { resolve: resolveContainerService }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: null,
    filterIds: [],
    allowedIds: [],
    tenantId,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { GET } from '../route'

describe('interaction conflict organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns no conflicts for empty scope instead of querying auth.orgId', async () => {
    const response = await GET(new Request(
      'http://localhost/api/customers/interactions/conflicts?date=2026-10-04&startTime=09%3A00&duration=30',
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { hasConflicts: false, conflicts: [] },
    })
    expect(resolveContainerService).not.toHaveBeenCalled()
  })
})
