/** @jest-environment node */
/**
 * A deployment that cannot resolve a model answers 503, not 500.
 *
 * The run executes behind the admission queue, so a model-factory failure has
 * usually lost its prototype by the time this route catches it — CI caught a
 * pinned-provider failure ("the model is pinned to openai, but that provider is
 * not configured") sailing past the `instanceof` branch into the unclassified
 * 500, which reads as a product defect rather than a mis-provisioned
 * environment. The route matches the error's name and code instead, and those
 * survive the crossing.
 */
import { POST } from '../api/agents/[id]/run/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => undefined),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'deals.health_check'

const params = Promise.resolve({ id: AGENT_ID })

function makeRequest() {
  return new Request(`http://localhost/api/agent_orchestrator/agents/${AGENT_ID}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { deal: { id: 'deal-1' } } }),
  })
}

async function mockAuthAndScope() {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { resolveOrganizationScopeForRequest } = await import(
    '@open-mercato/core/modules/directory/utils/organizationScope'
  )
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
  ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
    selectedId: ORG,
    filterIds: [ORG],
    allowedIds: [ORG],
    tenantId: TENANT,
  })
}

async function setupContainerThrowing(error: unknown) {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'agentRuntime') {
        return {
          run: async () => {
            throw error
          },
        }
      }
      if (token === 'em') return { fork: () => ({ find: async () => [] }) }
      return null
    },
  })
}

/** The shape that reaches the route: the name and code, without the prototype. */
function prototypeLessFactoryError(code: string, message: string) {
  const error = new Error(message)
  error.name = 'AiModelFactoryError'
  ;(error as Error & { code?: string }).code = code
  return error
}

describe('POST /api/agent_orchestrator/agents/:id/run — a deployment that cannot resolve a model', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('answers 503 for a pinned provider that is not configured, prototype or not', async () => {
    await mockAuthAndScope()
    await setupContainerThrowing(
      prototypeLessFactoryError(
        'no_provider_configured',
        'The resolved model is pinned to provider "openai", but that provider is not configured.',
      ),
    )

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'no_provider_configured' })
  })

  it('keeps the factory error code when it names a known one', async () => {
    await mockAuthAndScope()
    await setupContainerThrowing(
      prototypeLessFactoryError('api_key_missing', 'resolveApiKey() returned empty.'),
    )

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'api_key_missing' })
  })

  it('still reports an unrelated failure as an unclassified 500 that names itself', async () => {
    await mockAuthAndScope()
    await setupContainerThrowing(new TypeError('column "nope" does not exist'))

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('agent_run_failed')
    expect(body.reason).toContain('column "nope" does not exist')
  })
})
