/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const entityId = '33333333-3333-4333-8333-333333333333'

const resolveContainerService = jest.fn()
const container = { resolve: resolveContainerService }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
  })),
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

describe('interaction counts organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns zero counts without querying when resolved scope is empty and auth.orgId is set', async () => {
    const response = await GET(
      new Request(`http://localhost/api/customers/interactions/counts?entityId=${entityId}`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { call: 0, email: 0, meeting: 0, note: 0, task: 0, total: 0 },
    })
    expect(resolveContainerService).not.toHaveBeenCalled()
  })
})
