import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockCommandBus = {
  execute: jest.fn(),
}

const mockRouteContext = {
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  translate: (_key: string, fallback?: string) => fallback ?? _key,
  container: {
    resolve: jest.fn((token: string) => {
      if (token === 'commandBus') return mockCommandBus
      throw new Error(`Unexpected token ${token}`)
    }),
  },
  em: {
    fork: jest.fn(() => ({
      findOne: jest.fn(),
    })),
  },
  cache: undefined,
  ctx: {
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'],
    container: null,
    request: null,
  },
}
mockRouteContext.ctx.container = mockRouteContext.container

jest.mock('../../../context', () => ({
  mapDictionaryKind: jest.fn(() => ({
    kind: 'person-company-roles',
    mappedKind: 'person_company_role',
  })),
  resolveDictionaryRouteContext: jest.fn(async () => mockRouteContext),
}))

jest.mock('../../../cache', () => ({
  invalidateDictionaryCache: jest.fn(async () => undefined),
}))

describe('customer dictionary entry routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a translated 409 when deleting a role type that is still in use', async () => {
    mockCommandBus.execute.mockRejectedValue(
      new CrudHttpError(409, {
        code: 'role_type_in_use',
        error: 'Role type is in use',
        usageCount: 4,
      }),
    )

    const { DELETE } = await import('../route')
    const response = await DELETE(
      new Request('http://localhost/api/customers/dictionaries/person-company-roles/11111111-1111-4111-8111-111111111111', {
        method: 'DELETE',
      }),
      { params: { kind: 'person-company-roles', id: '11111111-1111-4111-8111-111111111111' } },
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual(
      expect.objectContaining({
        code: 'role_type_in_use',
        usageCount: 4,
        error: 'This role type is assigned to 4 records. Remove or replace those assignments before deleting it.',
      }),
    )
  })

  it('returns a translated 409 when changing the value of a role type that is still in use', async () => {
    mockCommandBus.execute.mockRejectedValue(
      new CrudHttpError(409, {
        code: 'role_type_in_use',
        error: 'Role type is in use',
        usageCount: 2,
      }),
    )

    const { PATCH } = await import('../route')
    const response = await PATCH(
      new Request('http://localhost/api/customers/dictionaries/person-company-roles/11111111-1111-4111-8111-111111111111', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'new_value' }),
      }),
      { params: { kind: 'person-company-roles', id: '11111111-1111-4111-8111-111111111111' } },
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual(
      expect.objectContaining({
        code: 'role_type_in_use',
        usageCount: 2,
        error: 'This role type is assigned to 2 records. Remove or replace those assignments before changing its value.',
      }),
    )
  })
})
