/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'

const mockExecute = jest.fn()
const mockResolvePortalActionContext = jest.fn()
const mockLoadOwnedClaim = jest.fn()
const mockRunPortalClaimActionGuard = jest.fn()
const mockRunAfterSuccess = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('../../shared', () => ({
  resolvePortalClaimId: jest.fn(async () => CLAIM_ID),
  resolvePortalActionContext: jest.fn((req: Request) => mockResolvePortalActionContext(req)),
  loadOwnedClaim: jest.fn((...args: unknown[]) => mockLoadOwnedClaim(...args)),
  runPortalClaimActionGuard: jest.fn((...args: unknown[]) => mockRunPortalClaimActionGuard(...args)),
}))

const CLAIM_ID = '33333333-3333-4333-8333-333333333333'

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const buildRequest = () =>
  new Request(`http://localhost/api/warranty_claims/portal/claims/${CLAIM_ID}/withdraw`, { method: 'POST' })

const routeContext = { params: Promise.resolve({ id: CLAIM_ID }) }

/**
 * The portal action routes end their `catch` with a rethrow instead of a generic
 * answer, so the interceptor branch has to sit ahead of it: without the branch a
 * deliberate 422 would leave the handler as an unhandled error.
 */
describe('warranty_claims portal withdraw route — command interceptor HTTP status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolvePortalActionContext.mockResolvedValue({
      customerId: 'customer-1',
      commandCtx: { container: mockContainer },
    })
    mockLoadOwnedClaim.mockResolvedValue({ id: CLAIM_ID, status: 'submitted' })
    mockRunPortalClaimActionGuard.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
    mockExecute.mockResolvedValue({ result: { claimId: CLAIM_ID } })
  })

  it('withdraws the claim when nothing blocks it', async () => {
    const response = await postHandler(buildRequest(), routeContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, claimId: CLAIM_ID, status: 'cancelled' })
  })

  it('surfaces the status and body of an interceptor rejection that carries one', async () => {
    mockExecute.mockRejectedValueOnce(
      new CommandInterceptorError('Withdrawal window closed', {
        status: 422,
        body: { error: 'Withdrawal window closed' },
      }),
    )

    const response = await postHandler(buildRequest(), routeContext)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Withdrawal window closed' })
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('still rethrows a rejection that carries no status', async () => {
    const rejection = new CommandInterceptorError('Blocked without a status')
    mockExecute.mockRejectedValueOnce(rejection)

    await expect(postHandler(buildRequest(), routeContext)).rejects.toBe(rejection)
  })
})
