/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const currentUpdatedAt = '2026-06-18T10:00:00.000Z'
const staleUpdatedAt = '2026-06-17T10:00:00.000Z'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const deleteByTags = jest.fn(async () => {})
const commandBusExecute = jest.fn()
const runWithCacheTenantMock = jest.fn(async (_tenantId: string | null, fn: () => unknown) => await fn())
const validateMutation = jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false, metadata: null }))
const afterMutationSuccess = jest.fn(async () => {})
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return {}
    if (name === 'cache') return { deleteByTags }
    if (name === 'commandBus') return { execute: commandBusExecute }
    if (name === 'crudMutationGuardService') return { validateMutation, afterMutationSuccess }
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

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (...args: unknown[]) => runWithCacheTenantMock(...args as [string | null, () => unknown]),
}))

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
    updatedAt: new Date(currentUpdatedAt),
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
  validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false, metadata: null })
  afterMutationSuccess.mockResolvedValue(undefined)
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
      updatedAt: currentUpdatedAt,
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
    expect(runWithCacheTenantMock).toHaveBeenCalledWith(tenantId, expect.any(Function))
    expect(deleteByTags).toHaveBeenCalledWith([
      `nav:sidebar:organization:${organizationId}`,
      `nav:sidebar:tenant:${tenantId}`,
    ])
    await expect(response.json()).resolves.toEqual({
      organizationId,
      organizationName: 'Acme',
      tenantId,
      logoUrl: 'https://example.com/logo.svg',
      updatedAt: currentUpdatedAt,
    })
  })

  it('accepts an internal attachment URL with a query string', async () => {
    const logoUrl = '/api/attachments/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/acme.svg?width=320&height=320'
    commandBusExecute.mockResolvedValue({ result: makeOrganization({ logoUrl }) })

    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      body: JSON.stringify({ logoUrl }),
    }))

    expect(response.status).toBe(200)
    expect(commandBusExecute).toHaveBeenCalledWith(
      'directory.organizations.update',
      expect.objectContaining({
        input: {
          id: organizationId,
          tenantId,
          logoUrl,
        },
      }),
    )
    await expect(response.json()).resolves.toEqual({
      organizationId,
      organizationName: 'Acme',
      tenantId,
      logoUrl,
      updatedAt: currentUpdatedAt,
    })
  })

  it('allows an explicit null logo URL to reset branding', async () => {
    commandBusExecute.mockResolvedValue({ result: makeOrganization({ logoUrl: null }) })

    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      body: JSON.stringify({ logoUrl: null }),
    }))

    expect(response.status).toBe(200)
    expect(commandBusExecute).toHaveBeenCalledWith(
      'directory.organizations.update',
      expect.objectContaining({
        input: {
          id: organizationId,
          tenantId,
          logoUrl: null,
        },
      }),
    )
    await expect(response.json()).resolves.toEqual({
      organizationId,
      organizationName: 'Acme',
      tenantId,
      logoUrl: null,
      updatedAt: currentUpdatedAt,
    })
  })

  it('rejects requests that omit logoUrl', async () => {
    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(422)
    expect(commandBusExecute).not.toHaveBeenCalled()
    const body = await response.json() as { error?: string }
    expect(body.error).toBe('Enter a valid image URL.')
  })

  it('rejects malformed JSON instead of resetting branding', async () => {
    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      body: '{',
    }))

    expect(response.status).toBe(422)
    expect(commandBusExecute).not.toHaveBeenCalled()
    const body = await response.json() as { error?: string }
    expect(body.error).toBe('Enter a valid image URL.')
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

  it('rejects a stale branding update with a 409 optimistic-lock conflict', async () => {
    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER]: staleUpdatedAt,
      },
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.svg' }),
    }))

    expect(response.status).toBe(409)
    expect(commandBusExecute).not.toHaveBeenCalled()
    expect(deleteByTags).not.toHaveBeenCalled()
    const body = await response.json() as { code?: string; currentUpdatedAt?: string; expectedUpdatedAt?: string }
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(currentUpdatedAt)
    expect(body.expectedUpdatedAt).toBe(staleUpdatedAt)
  })

  it('updates branding when the expected version matches the current one', async () => {
    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER]: currentUpdatedAt,
      },
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.svg' }),
    }))

    expect(response.status).toBe(200)
    expect(commandBusExecute).toHaveBeenCalledTimes(1)
  })

  it('blocks the branding update when the mutation guard denies it', async () => {
    validateMutation.mockResolvedValue({ ok: false, status: 423, body: { error: 'Record is locked' } })

    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.svg' }),
    }))

    expect(response.status).toBe(423)
    expect(commandBusExecute).not.toHaveBeenCalled()
    expect(deleteByTags).not.toHaveBeenCalled()
    const body = await response.json() as { error?: string }
    expect(body.error).toBe('Record is locked')
  })

  it('runs the mutation-guard after-success hook when requested', async () => {
    validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { reason: 'test' } })

    const response = await PUT(new Request('http://localhost/api/directory/organization-branding', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.svg' }),
    }))

    expect(response.status).toBe(200)
    expect(afterMutationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'directory.organization',
        resourceId: organizationId,
        operation: 'update',
        metadata: { reason: 'test' },
      }),
    )
  })
})
