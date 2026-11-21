import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadAssistedSellingStoreSettings } from '../../../../lib/settings'
import { AssistedSellingStoreSettings } from '../../../../data/entities'
import { GET, PUT, metadata } from '../route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(async () => ({ ok: true, modifiedPayload: null, runAfterSuccess: async () => undefined })),
}))
jest.mock('../../../../lib/settings', () => {
  const actual = jest.requireActual('../../../../lib/settings')
  return { ...actual, loadAssistedSellingStoreSettings: jest.fn() }
})

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const SELECTED_ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ORG_ID = '44444444-4444-4444-8444-444444444444'
const STORE_ID = '33333333-3333-4333-8333-333333333333'

const getAuthMock = getAuthFromRequest as jest.Mock
const createContainerMock = createRequestContainer as jest.Mock
const scopeMock = resolveOrganizationScopeForRequest as jest.Mock
const loadMock = loadAssistedSellingStoreSettings as jest.Mock

type Services = Record<string, unknown>

function setup(services: Services = {}) {
  const findStoreForOrganizations = jest.fn(async () => ({ id: STORE_ID, tenantId: TENANT_ID, organizationId: STORE_ORG_ID }))
  const execute = jest.fn(async (_id: string, { input }: { input: Record<string, unknown> }) => ({
    result: {
      settingsId: '55555555-5555-4555-8555-555555555555',
      storeId: input.storeId,
      mode: input.mode ?? 'off',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
      updatedAt: '2026-11-20T00:00:00.000Z',
    },
  }))
  const registry: Services = {
    em: {},
    storeContextService: { findStoreForOrganizations },
    commandBus: { execute },
    ...services,
  }
  createContainerMock.mockResolvedValue({
    resolve: (name: string) => {
      if (!(name in registry)) throw new Error(`[internal] unregistered ${name}`)
      return registry[name]
    },
  })
  return { findStoreForOrganizations, execute }
}

type TestAuth = { sub: string; tenantId: string | null; orgId: string | null } | null

let currentAuth: TestAuth = null

function routeCtx(storeId: string = STORE_ID) {
  return { params: Promise.resolve({ storeId }), auth: currentAuth }
}

function putRequest(body: unknown) {
  return new Request(`http://localhost/api/assisted_selling/settings/${STORE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const getRequest = () => new Request(`http://localhost/api/assisted_selling/settings/${STORE_ID}`)

beforeEach(() => {
  jest.clearAllMocks()
  currentAuth = { sub: 'user-1', tenantId: TENANT_ID, orgId: SELECTED_ORG_ID }
  scopeMock.mockResolvedValue({
    tenantId: TENANT_ID,
    selectedId: SELECTED_ORG_ID,
    filterIds: [SELECTED_ORG_ID],
    allowedIds: [SELECTED_ORG_ID, STORE_ORG_ID],
  })
  loadMock.mockResolvedValue(null)
})

describe('assisted_selling settings route metadata', () => {
  it('requires assisted_selling.settings.manage on GET and PUT', () => {
    expect(metadata.GET.requireFeatures).toEqual(['assisted_selling.settings.manage'])
    expect(metadata.PUT.requireFeatures).toEqual(['assisted_selling.settings.manage'])
  })
})

describe('GET /api/assisted_selling/settings/:storeId', () => {
  it('answers 401 without a tenant-bound principal', async () => {
    setup()
    currentAuth = null
    const res = await GET(getRequest(), routeCtx())
    expect(res.status).toBe(401)
  })

  it('uses the dispatcher-verified ctx.auth instead of re-resolving the request auth', async () => {
    setup()
    const res = await GET(getRequest(), routeCtx())
    expect(res.status).toBe(200)
    expect(getAuthMock).not.toHaveBeenCalled()
    expect(scopeMock).toHaveBeenCalledWith(expect.objectContaining({ auth: currentAuth }))
  })

  it('answers 400 for a store id that is not a uuid', async () => {
    setup()
    const res = await GET(getRequest(), routeCtx('not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('answers 404 when ecommerce is absent', async () => {
    createContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return {}
        throw new Error(`[internal] unregistered ${name}`)
      },
    })
    const res = await GET(getRequest(), routeCtx())
    expect(res.status).toBe(404)
  })

  it('answers 404 for a store outside the caller\'s organizations or unknown', async () => {
    const { findStoreForOrganizations } = setup()
    findStoreForOrganizations.mockResolvedValueOnce(null as never)
    const res = await GET(getRequest(), routeCtx())
    expect(res.status).toBe(404)
    expect(findStoreForOrganizations).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationIds: [SELECTED_ORG_ID, STORE_ORG_ID],
      storeId: STORE_ID,
    })
  })

  it('returns the §5.6 defaults when no row exists, read under the store\'s organization', async () => {
    setup()
    const res = await GET(getRequest(), routeCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      result: {
        storeId: STORE_ID,
        mode: 'off',
        proposalTtlSeconds: 259200,
        maxProposalLines: 50,
        conversationRetentionDays: 365,
        idleCloseDays: 30,
        updatedAt: null,
      },
    })
    expect(loadMock).toHaveBeenCalledWith({}, { tenantId: TENANT_ID, organizationId: STORE_ORG_ID, storeId: STORE_ID })
  })

  it('returns a stored row with its version', async () => {
    setup()
    loadMock.mockResolvedValue(Object.assign(new AssistedSellingStoreSettings(), {
      id: 'row-1',
      storeId: STORE_ID,
      mode: 'rep',
      updatedAt: new Date('2026-11-19T10:00:00.000Z'),
    }))
    const res = await GET(getRequest(), routeCtx())
    const body = await res.json()
    expect(body.result.mode).toBe('rep')
    expect(body.result.updatedAt).toBe('2026-11-19T10:00:00.000Z')
  })
})

describe('PUT /api/assisted_selling/settings/:storeId', () => {
  it('writes under the store\'s organization, not the caller\'s selected one', async () => {
    const { execute } = setup()
    const res = await PUT(putRequest({ mode: 'rep' }), routeCtx())
    expect(res.status).toBe(200)
    expect(execute).toHaveBeenCalledWith('assisted_selling.settings.save', expect.objectContaining({
      input: { mode: 'rep', tenantId: TENANT_ID, organizationId: STORE_ORG_ID, storeId: STORE_ID },
    }))
    expect((await res.json()).result.mode).toBe('rep')
  })

  it.each([
    [{ mode: 'ai' }],
    [{ mode: 'both' }],
    [{ aiProposalsRequireRepApproval: true }],
    [{ aiAgentUserId: '66666666-6666-4666-8666-666666666666' }],
    [{ proposalTtlSeconds: 60 }],
    [{ maxProposalLines: 101 }],
    [{ conversationRetentionDays: 3651 }],
    [{ idleCloseDays: 0 }],
  ])('answers 400 for %j without running the command', async (body) => {
    const { execute } = setup()
    const res = await PUT(putRequest(body), routeCtx())
    expect(res.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  it('answers 404 for a store outside the caller\'s organizations', async () => {
    const { findStoreForOrganizations, execute } = setup()
    findStoreForOrganizations.mockResolvedValueOnce(null as never)
    const res = await PUT(putRequest({ mode: 'rep' }), routeCtx())
    expect(res.status).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })

  it('passes an optimistic-lock conflict through as 409', async () => {
    const { execute } = setup()
    execute.mockRejectedValueOnce(new CrudHttpError(409, { error: 'conflict', code: 'optimistic_lock_conflict' }))
    const res = await PUT(putRequest({ mode: 'off' }), routeCtx())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('optimistic_lock_conflict')
  })

  it('answers 500, not 400, on an unexpected failure', async () => {
    const { execute } = setup()
    execute.mockRejectedValueOnce(new Error('boom'))
    const res = await PUT(putRequest({ mode: 'off' }), routeCtx())
    expect(res.status).toBe(500)
  })
})
