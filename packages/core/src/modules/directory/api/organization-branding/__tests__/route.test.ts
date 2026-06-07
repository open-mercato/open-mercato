/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const deleteByTags = jest.fn(async () => {})
const commandBusExecute = jest.fn()
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return {}
    if (name === 'cache') return { deleteByTags }
    if (name === 'commandBus') return { execute: commandBusExecute }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const getAuthFromRequestMock = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

const resolveOrganizationScopeForRequestMock = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

const findOneWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/commands/organizations', () => ({}))

import { GET, PUT } from '../route'

function makeAuth(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
    roles: ['admin'],
    ...overrides,
  }
}

function makeOrganization(overrides: Record<string, unknown> = {}) {
  return {
    id: organizationId,
    name: 'Acme',
    logoUrl: '/api/attachments/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme.png?width=320&height=320',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequestMock.mockResolvedValue(makeAuth())
  resolveOrganizationScopeForRequestMock.mockResolvedValue({
    selectedId: organizationId,
    filterIds: [organizationId],
    allowedIds: [organizationId],
    tenantId,
  })
  findOneWithDecryptionMock.mockResolvedValue(makeOrganization())
  commandBusExecute.mockResolvedValue({ result: makeOrganization({ logoUrl: 'https://example.com/logo.svg' }) })
})

describe('/api/directory/organization-branding', () => {
  it('returns branding for the selected organization', async () => {
    const response = await GET(new Request('http://localhost/api/directory/organization-branding'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      organizationId,
      organizationName: 'Acme',
      tenantId,
      logoUrl: '/api/attachments/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme.png?width=320&height=320',
    })
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: organizationId, tenant: tenantId, deletedAt: null },
      { populate: ['tenant'] },
      { tenantId, organizationId },
    )
  })

  it('rejects all-organizations scope because branding needs one organization', async () => {
    getAuthFromRequestMock.mockResolvedValue(makeAuth({ orgId: null, isSuperAdmin: true }))
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId,
    })

    const response = await GET(new Request('http://localhost/api/directory/organization-branding'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Select a single organization before changing sidebar branding.',
    })
  })

  it('updates branding through the organization command and invalidates sidebar cache tags', async () => {
    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.svg' }),
    }))

    expect(response.status).toBe(200)
    expect(commandBusExecute).toHaveBeenCalledWith(
      'directory.organizations.update',
      expect.objectContaining({
        input: {
          id: organizationId,
          tenantId,
          logoUrl: 'https://example.com/logo.svg',
        },
      }),
    )
    expect(deleteByTags).toHaveBeenCalledWith([
      `nav:sidebar:organization:${organizationId}`,
      `nav:sidebar:tenant:${tenantId}`,
    ])
    await expect(response.json()).resolves.toEqual({
      organizationId,
      organizationName: 'Acme',
      tenantId,
      logoUrl: 'https://example.com/logo.svg',
    })
  })

  it('rejects malformed logo URLs', async () => {
    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      body: JSON.stringify({ logoUrl: 'javascript:alert(1)' }),
    }))

    expect(response.status).toBe(422)
    expect(commandBusExecute).not.toHaveBeenCalled()
    const body = await response.json() as { error?: string }
    expect(body.error).toBe('Enter a valid image URL.')
  })
})
