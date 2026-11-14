import type { DocumentsRouteContext } from '../api/_shared'

const mockResolvePermission = jest.fn()

jest.mock('../lib/permissions', () => {
  const actual = jest.requireActual('../lib/permissions')
  return {
    ...actual,
    resolvePermission: (...args: unknown[]) => mockResolvePermission(...args),
  }
})

import { assertFindingsAccess } from '../api/_findings'

const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

function routeContext(): DocumentsRouteContext {
  return {
    em: {},
    auth: { sub: 'user', tenantId: 'tenant', orgId: 'org' },
    tenantId: 'tenant',
    organizationId: 'org',
  } as unknown as DocumentsRouteContext
}

describe('findings route access', () => {
  beforeEach(() => mockResolvePermission.mockReset())

  it.each(['owner', 'editor'] as const)('allows the %s tier', async (tier) => {
    mockResolvePermission.mockResolvedValue(tier)
    await expect(assertFindingsAccess(routeContext(), DOCUMENT_ID)).resolves.toBeUndefined()
  })

  it.each(['commenter', 'viewer', null] as const)('hides findings from the %s tier with 404', async (tier) => {
    mockResolvePermission.mockResolvedValue(tier)
    await expect(assertFindingsAccess(routeContext(), DOCUMENT_ID))
      .rejects.toMatchObject({ status: 404 })
  })

  it('returns 404 for a malformed document id without resolving a tier', async () => {
    await expect(assertFindingsAccess(routeContext(), 'not-a-uuid')).rejects.toMatchObject({ status: 404 })
    expect(mockResolvePermission).not.toHaveBeenCalled()
  })
})
