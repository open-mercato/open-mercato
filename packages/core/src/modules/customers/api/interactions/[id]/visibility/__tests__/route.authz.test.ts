jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: 'org-1' })),
}))
jest.mock('../../../../../events', () => ({ emitCustomersEvent: jest.fn(async () => {}) }))
jest.mock('../../../../../lib/interactionRequestContext', () => ({
  resolveAuthActorId: (auth: { sub?: string }) => auth?.sub ?? 'actor',
}))

import { PATCH } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const mockAuth = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const INTERACTION_ID = '550e8400-e29b-41d4-a716-446655440099'
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440020'

function mockRequest(body: unknown) {
  return {
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    method: 'PATCH',
  } as unknown as Request
}

function routeCtx() {
  return { params: Promise.resolve({ id: INTERACTION_ID }) } as never
}

const em = { fork: () => em, flush: jest.fn(async () => {}) } as never
const commandBus = { execute: jest.fn(async () => ({ result: { interactionId: INTERACTION_ID } })) }

function setupContainer(grantedFeatures: string[]) {
  mockContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return { getGrantedFeatures: async () => grantedFeatures }
      if (name === 'commandBus') return commandBus
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PATCH visibility — authorization', () => {
  it('non-author without view_private gets 404 (existence not leaked)', async () => {
    mockAuth.mockResolvedValue({ sub: 'user-B', tenantId: TENANT_ID, orgId: 'org-1' } as never)
    setupContainer([]) // no admin bypass
    mockFindOne.mockResolvedValue({ id: INTERACTION_ID, authorUserId: 'user-A', visibility: 'private' } as never)

    const res = await PATCH(mockRequest({ visibility: 'shared' }), routeCtx())
    expect(res.status).toBe(404)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('author can flip their own email visibility', async () => {
    mockAuth.mockResolvedValue({ sub: 'user-A', tenantId: TENANT_ID, orgId: 'org-1' } as never)
    setupContainer([])
    mockFindOne.mockResolvedValue({ id: INTERACTION_ID, authorUserId: 'user-A', visibility: 'private' } as never)

    const res = await PATCH(mockRequest({ visibility: 'shared' }), routeCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, changed: true })
    // The write is delegated to the interactions update command (query-index
    // refresh + audit/undo), not a raw em.flush().
    expect(commandBus.execute).toHaveBeenCalledWith(
      'customers.interactions.update',
      expect.objectContaining({ input: { id: INTERACTION_ID, visibility: 'shared' } }),
    )
  })

  it('admin with customers.email.view_private is STILL denied a non-authored email (v1: no bypass)', async () => {
    // Personal mailbox privacy v1 — only the author may flip their own email's
    // visibility; admin grants no longer bypass this gate. 404 (not 403) so the
    // row's existence is never leaked.
    mockAuth.mockResolvedValue({ sub: 'user-B', tenantId: TENANT_ID, orgId: 'org-1' } as never)
    setupContainer(['customers.email.view_private'])
    mockFindOne.mockResolvedValue({ id: INTERACTION_ID, authorUserId: 'user-A', visibility: 'private' } as never)

    const res = await PATCH(mockRequest({ visibility: 'shared' }), routeCtx())
    expect(res.status).toBe(404)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('cross-tenant interaction id returns 404 (tenant-scoped lookup misses)', async () => {
    mockAuth.mockResolvedValue({ sub: 'user-A', tenantId: TENANT_ID, orgId: 'org-1' } as never)
    setupContainer(['customers.email.view_private'])
    mockFindOne.mockResolvedValue(null) // tenant-scoped lookup finds nothing

    const res = await PATCH(mockRequest({ visibility: 'shared' }), routeCtx())
    expect(res.status).toBe(404)
  })
})
