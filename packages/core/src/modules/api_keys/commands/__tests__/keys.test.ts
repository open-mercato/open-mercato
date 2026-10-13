jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

const mockDeleteApiKey = jest.fn()
const mockResolveIsSuperAdmin = jest.fn()

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  deleteApiKey: (...args: unknown[]) => mockDeleteApiKey(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  resolveIsSuperAdmin: (...args: unknown[]) => mockResolveIsSuperAdmin(...args),
}))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { deleteApiKeyCommand } from '../keys'

const tenantId = '11111111-1111-4111-8111-111111111111'
const allowedOrganizationId = '22222222-2222-4222-8222-222222222222'
const foreignOrganizationId = '33333333-3333-4333-8333-333333333333'

function makeContext(allowedIds: string[] | null = [allowedOrganizationId]) {
  const em = {}
  const rbacService = { invalidateUserCache: jest.fn() }
  return {
    em,
    rbacService,
    ctx: {
      auth: { sub: 'user-1', tenantId, orgId: allowedOrganizationId },
      organizationScope: { allowedIds },
      selectedOrganizationId: allowedOrganizationId,
      container: {
        resolve: (token: string) => token === 'em' ? em : token === 'rbacService' ? rbacService : undefined,
      },
    },
  }
}

describe('api_keys.keys.delete', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveIsSuperAdmin.mockResolvedValue(false)
  })

  it('authorizes tenant and organization scope while the API-key parent lock is held', async () => {
    const harness = makeContext()
    mockDeleteApiKey.mockImplementation(async (_em, _id, options) => {
      await options.authorize({
        tenantId,
        organizationId: allowedOrganizationId,
      })
      return true
    })

    await expect(deleteApiKeyCommand.execute(
      { id: 'key-1' },
      harness.ctx as never,
    )).resolves.toEqual({ id: 'key-1' })

    expect(mockDeleteApiKey).toHaveBeenCalledWith(
      harness.em,
      'key-1',
      expect.objectContaining({ rbac: harness.rbacService, authorize: expect.any(Function) }),
    )
  })

  it('fails closed for a key outside the locked actor scope', async () => {
    const harness = makeContext()
    mockDeleteApiKey.mockImplementation(async (_em, _id, options) => {
      await options.authorize({
        tenantId,
        organizationId: foreignOrganizationId,
      })
      return true
    })

    await expect(deleteApiKeyCommand.execute(
      { id: 'key-2' },
      harness.ctx as never,
    )).rejects.toEqual(expect.objectContaining<Partial<CrudHttpError>>({ status: 404 }))
  })

  it('returns the same not-found response when no live key can be locked', async () => {
    const harness = makeContext(null)
    mockDeleteApiKey.mockResolvedValue(false)

    await expect(deleteApiKeyCommand.execute(
      { id: 'key-3' },
      harness.ctx as never,
    )).rejects.toEqual(expect.objectContaining<Partial<CrudHttpError>>({ status: 404 }))
  })
})
