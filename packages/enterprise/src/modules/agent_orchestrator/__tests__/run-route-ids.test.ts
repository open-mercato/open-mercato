/** @jest-environment node */
// Navigation spec §1 (2026-07-12-ux-navigation-pass.md): the playground run
// route additively returns `runId` + `proposalId` next to the typed result,
// capturing the run id through the first `onRunPersisted` invocation and never
// mutating the result object's own keys.
import { POST } from '../api/agents/[id]/run/route'
import { shapeResult } from '../lib/runtime/persistence'

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
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const PROPOSAL_ID = '66666666-6666-4666-8666-666666666666'

function makeRequest(body: unknown = { input: { deal: { id: 'deal-1' } } }) {
  return new Request(`http://localhost/api/agent_orchestrator/agents/${AGENT_ID}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: AGENT_ID })

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

async function setupContainer(opts: {
  result: unknown
  invokeHook?: boolean | ((ctx: { onRunPersisted?: (id: string) => void }) => void)
  proposalRows?: Array<{ id: string }>
}) {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const find = jest.fn(async () => opts.proposalRows ?? [])
  const run = jest.fn(
    async (_agentId: string, _input: unknown, ctx: { onRunPersisted?: (id: string) => void }) => {
      if (typeof opts.invokeHook === 'function') opts.invokeHook(ctx)
      else if (opts.invokeHook !== false) ctx.onRunPersisted?.(RUN_ID)
      return opts.result
    },
  )
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'agentRuntime') return { run }
      if (token === 'em') return { fork: () => ({ find }) }
      return null
    },
  })
  return { run, find }
}

describe('POST /api/agent_orchestrator/agents/:id/run — additive runId/proposalId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns runId + proposalId alongside an actionable result, result keys untouched', async () => {
    await mockAuthAndScope()
    const actionable = shapeResult('actionable', {
      proposal: { actions: [{ type: 'set_stage', payload: { stage: 'won' } }], confidence: 0.9 },
    })
    const { find } = await setupContainer({ result: actionable, proposalRows: [{ id: PROPOSAL_ID }] })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runId).toBe(RUN_ID)
    expect(body.proposalId).toBe(PROPOSAL_ID)
    expect(body.kind).toBe('actionable')
    expect(body.proposal.confidence).toBe(0.9)
    expect(find).toHaveBeenCalledTimes(1)
    const [, where, options] = find.mock.calls[0] as unknown[] as [
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(where).toMatchObject({ runId: RUN_ID, tenantId: TENANT, organizationId: ORG, deletedAt: null })
    expect(options).toMatchObject({ limit: 1, fields: ['id'] })
  })

  it('returns proposalId null for an informative run with no proposal', async () => {
    await mockAuthAndScope()
    const { } = await setupContainer({
      result: shapeResult('informative', { data: { ok: true } }),
      proposalRows: [],
    })

    const res = await POST(makeRequest(), { params })
    const body = await res.json()
    expect(body.runId).toBe(RUN_ID)
    expect(body.proposalId).toBeNull()
    expect(body.kind).toBe('informative')
  })

  it('keeps only the FIRST onRunPersisted invocation (nested delegations fire it again)', async () => {
    await mockAuthAndScope()
    const { } = await setupContainer({
      result: shapeResult('informative', { data: {} }),
      invokeHook: (ctx) => {
        ctx.onRunPersisted?.(RUN_ID)
        ctx.onRunPersisted?.('99999999-9999-4999-8999-999999999999')
      },
    })

    const res = await POST(makeRequest(), { params })
    const body = await res.json()
    expect(body.runId).toBe(RUN_ID)
  })

  it('BC: returns runId null without querying proposals when the runtime never fires the hook, and shaped results never define the additive keys', async () => {
    await mockAuthAndScope()
    const { find } = await setupContainer({
      result: shapeResult('informative', { data: {} }),
      invokeHook: false,
    })

    const res = await POST(makeRequest(), { params })
    const body = await res.json()
    expect(body.runId).toBeNull()
    expect(body.proposalId).toBeNull()
    expect(find).not.toHaveBeenCalled()

    // Collision safety (spec risk table): the AgentResult shape never carries
    // the additive keys itself, so the spread cannot mask agent data.
    const shapedInformative = shapeResult('informative', { data: { x: 1 } })
    const shapedActionable = shapeResult('actionable', { proposal: { actions: [] } })
    expect('runId' in shapedInformative).toBe(false)
    expect('proposalId' in shapedInformative).toBe(false)
    expect('runId' in shapedActionable).toBe(false)
    expect('proposalId' in shapedActionable).toBe(false)
  })
})
