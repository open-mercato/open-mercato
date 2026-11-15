/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((...args: unknown[]) => mockRunRouteMutationGuards(...args)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const CLAIM_ID = '22222222-2222-4222-8222-222222222222'

const buildRequest = () =>
  new Request('http://localhost/api/warranty_claims/transition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: CLAIM_ID, toStatus: 'approved' }),
  })

describe('warranty_claims transition route — command interceptor HTTP status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['warranty_claims.claim.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockExecute.mockResolvedValue({ result: { claimId: CLAIM_ID } })
  })

  it('transitions the claim when nothing blocks it', async () => {
    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, claimId: CLAIM_ID })
    expect(mockExecute).toHaveBeenCalledWith('warranty_claims.claim.transition', expect.anything())
  })

  it('surfaces the status and body of an interceptor rejection that carries one', async () => {
    mockExecute.mockRejectedValueOnce(
      new CommandInterceptorError('Transition blocked by policy', {
        status: 422,
        body: { error: 'Transition blocked by policy', requiredRole: 'warranty-lead' },
      }),
    )

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transition blocked by policy',
      requiredRole: 'warranty-lead',
    })
  })

  it('keeps the historical generic 400 when the rejection carries no status', async () => {
    mockExecute.mockRejectedValueOnce(new CommandInterceptorError('Blocked without a status'))

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to save warranty claim' })
  })

  it('still maps CrudHttpError ahead of the interceptor branch', async () => {
    mockExecute.mockRejectedValueOnce(new CrudHttpError(409, { error: 'Claim already closed' }))

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Claim already closed' })
  })
})
