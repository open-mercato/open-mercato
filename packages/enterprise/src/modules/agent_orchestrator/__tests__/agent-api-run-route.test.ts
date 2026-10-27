/** @jest-environment node */
import { NextResponse } from 'next/server'
import { POST, metadata } from '../api/agent-api/agents/[id]/run/route'
import { AgentInvokeDeniedError, AGENT_INVOKE_DENIED_CODE } from '../lib/runtime/errors'
import { AgentNotFoundError } from '../lib/runtime/agentRuntime'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => undefined),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('../lib/identity/agentTokenService', () => ({
  verifyAgentToken: jest.fn(),
}))

jest.mock('../lib/guardrails/publicEndpointRateLimit', () => ({
  enforcePublicEndpointRateLimit: jest.fn(async () => null),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { verifyAgentToken } from '../lib/identity/agentTokenService'
import { enforcePublicEndpointRateLimit } from '../lib/guardrails/publicEndpointRateLimit'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const AGENT_USER = '33333333-3333-4333-8333-333333333333'
const HUMAN = '44444444-4444-4444-8444-444444444444'
const GRANT = '55555555-5555-4555-8555-555555555555'
const RUN_ID = '66666666-6666-4666-8666-666666666666'
const PROPOSAL_ID = '77777777-7777-4777-8777-777777777777'
const AGENT_ID = 'deals.health_check'

const verifyMock = verifyAgentToken as jest.Mock
const rateLimitMock = enforcePublicEndpointRateLimit as jest.Mock

function makeRequest(headers: Record<string, string> = { authorization: 'Bearer agent-token' }) {
  return new Request(`http://localhost/api/agent_orchestrator/agent-api/agents/${AGENT_ID}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ input: { deal: { id: 'deal-1' } } }),
  })
}

const params = () => Promise.resolve({ id: AGENT_ID })

function verified(scope: string) {
  return {
    claims: {
      iss: 'open-mercato',
      aud: 'agent',
      sub: AGENT_USER,
      obo: HUMAN,
      tenantId: TENANT,
      organizationId: ORG,
      scope,
      grantId: GRANT,
    },
    actorUserId: AGENT_USER,
    onBehalfOfUserId: HUMAN,
    scopes: scope.split(' ').filter(Boolean),
  }
}

function setupContainer(runImpl?: (agentId: string, input: unknown, ctx: Record<string, unknown>) => Promise<unknown>) {
  const find = jest.fn(async () => [{ id: PROPOSAL_ID }])
  const run = jest.fn(
    runImpl ??
      (async (_agentId: string, _input: unknown, ctx: Record<string, unknown>) => {
        ;(ctx.onRunPersisted as (id: string) => void)(RUN_ID)
        return { kind: 'proposal', proposal: { summary: 'ok' } }
      }),
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

describe('POST /agent-api/agents/:id/run', () => {
  const previousFlag = process.env.OM_AGENT_API_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_AGENT_API_ENABLED = 'true'
    rateLimitMock.mockResolvedValue(null)
  })

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.OM_AGENT_API_ENABLED
    else process.env.OM_AGENT_API_ENABLED = previousFlag
  })

  it('opts out of staff authentication so the handler sees agent tokens', () => {
    expect(metadata.POST).toEqual({ requireAuth: false })
  })

  it.each([undefined, 'false', '0'])('is invisible when OM_AGENT_API_ENABLED=%s', async (flag) => {
    if (flag === undefined) delete process.env.OM_AGENT_API_ENABLED
    else process.env.OM_AGENT_API_ENABLED = flag
    const { run } = setupContainer()
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(404)
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(verifyMock).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('answers 429 from the rate limiter before verifying the token', async () => {
    setupContainer()
    rateLimitMock.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }))
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(429)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing header', {}],
    ['non-bearer scheme', { authorization: 'Basic abc' }],
  ])('answers a minimal 401 for a %s', async (_label, headers) => {
    const { run } = setupContainer()
    const res = await POST(makeRequest(headers), { params: params() })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(verifyMock).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('answers a minimal 401 when the token fails verification (bad, expired or revoked)', async () => {
    const { run } = setupContainer()
    verifyMock.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(verifyMock).toHaveBeenCalledWith(expect.anything(), 'agent-token')
    expect(run).not.toHaveBeenCalled()
  })

  it('answers 403 agent_invoke_denied when the token scope covers neither the run capability nor this agent', async () => {
    const { run } = setupContainer()
    verifyMock.mockResolvedValue(verified('agent:other.agent customers:read'))
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'You are not allowed to run this agent',
      code: AGENT_INVOKE_DENIED_CODE,
      agentId: AGENT_ID,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('maps a runtime invoke denial (principal role lacks the agent features) to 403', async () => {
    setupContainer(async () => {
      throw new AgentInvokeDeniedError(AGENT_ID)
    })
    verifyMock.mockResolvedValue(verified(`agent:${AGENT_ID}`))
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe(AGENT_INVOKE_DENIED_CODE)
    expect(body.agentId).toBe(AGENT_ID)
  })

  it('maps an unknown agent to 404 like the staff run route', async () => {
    setupContainer(async () => {
      throw new AgentNotFoundError(AGENT_ID)
    })
    verifyMock.mockResolvedValue(verified('agent_orchestrator.agents.run'))
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('agent_not_found')
  })

  it('runs as the token principal on behalf of the delegator and returns the run contract', async () => {
    const { run, find } = setupContainer()
    verifyMock.mockResolvedValue(verified('agent_orchestrator.agents.run'))
    const res = await POST(makeRequest({ authorization: 'Bearer agent-token', 'x-correlation-id': 'corr-42' }), {
      params: params(),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      kind: 'proposal',
      proposal: { summary: 'ok' },
      runId: RUN_ID,
      proposalId: PROPOSAL_ID,
    })
    expect(run).toHaveBeenCalledTimes(1)
    const [agentId, input, ctx] = run.mock.calls[0]
    expect(agentId).toBe(AGENT_ID)
    expect(input).toEqual({ deal: { id: 'deal-1' } })
    expect(ctx).toMatchObject({
      tenantId: TENANT,
      organizationId: ORG,
      userId: AGENT_USER,
      invoker: { kind: 'agent_token', agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN, grantId: GRANT },
      runAs: { agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN },
      entryPoint: 'agent_api',
      correlationId: 'corr-42',
    })
    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId: RUN_ID, tenantId: TENANT, organizationId: ORG }),
      expect.anything(),
    )
  })

  it('accepts a per-agent scope and generates a correlation id when none is sent', async () => {
    const { run } = setupContainer()
    verifyMock.mockResolvedValue(verified(`agent:${AGENT_ID}`))
    const res = await POST(makeRequest(), { params: params() })
    expect(res.status).toBe(200)
    const ctx = run.mock.calls[0][2] as { correlationId: string }
    expect(ctx.correlationId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
