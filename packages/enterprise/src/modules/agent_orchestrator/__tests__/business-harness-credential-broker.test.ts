/** @jest-environment node */
// The credential broker is the only place a provider key or a caller-scoped MCP key
// leaves OM, and it is reachable without a staff session: the audience-bound run
// grant IS the credential. Every rejection below is load-bearing, so each one is
// pinned here rather than left to the grant verifier alone.
process.env.JWT_SECRET = 'business-harness-broker-test-secret-0123456789abcdef'
process.env.OPENAI_API_KEY = 'sk-provider-key-under-test'

import type { AwilixContainer } from 'awilix'
import type { LlmProvider } from '@open-mercato/shared/lib/ai/llm-provider'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { AgentRun } from '../data/entities'
import { issueBusinessHarnessRunGrant } from '../lib/runtime/businessHarnessGrant'

const findSessionApiKeyWithSecret = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findSessionApiKeyWithSecret: (...args: unknown[]) => findSessionApiKeyWithSecret(...args),
}))

const containerResolve = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () =>
    ({
      hasRegistration: () => false,
      resolve: (key: string) => containerResolve(key),
    }) as unknown as AwilixContainer,
}))

import { POST } from '../api/internal/credentials/exchange/route'

const RUN = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'
const AGENT = 'deals.health_check'
const SESSION_TOKEN = 'session-token-value'
const SESSION_SECRET = 'omk_session.secretsecretsecretsecret'

const MODEL_CLAIM = {
  audience: 'model:openai',
  bindingId: 'om-env-provider:openai',
  providerId: 'openai',
}
const CAPABILITY_CLAIM = {
  audience: 'open-mercato:mcp',
  bindingId: 'open-mercato-default',
  sessionToken: SESSION_TOKEN,
}

let runRows: Array<Record<string, unknown>> = []

function fakeEm() {
  const em = {
    async findOne(entity: unknown, where: Record<string, unknown>) {
      if (entity !== AgentRun) return null
      return (
        runRows.find((row) =>
          Object.entries(where).every(([key, value]) =>
            value === null ? row[key] === null || row[key] === undefined : row[key] === value,
          ),
        ) ?? null
      )
    },
    fork: () => em,
  }
  return em
}

function grant(overrides: Partial<Parameters<typeof issueBusinessHarnessRunGrant>[0]> = {}) {
  return issueBusinessHarnessRunGrant({
    runId: RUN,
    agentId: AGENT,
    agentDigest: 'a'.repeat(64),
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER,
    model: MODEL_CLAIM,
    capability: CAPABILITY_CLAIM,
    ttlMs: 210_000,
    ...overrides,
  }).token
}

function request(body: Record<string, unknown>, token: string | null = grant()) {
  return new Request('http://localhost/api/agent_orchestrator/internal/credentials/exchange', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function modelBody(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: '1',
    runId: RUN,
    purpose: 'model',
    audience: MODEL_CLAIM.audience,
    bindingId: MODEL_CLAIM.bindingId,
    minimumTtlMs: 125_000,
    ...overrides,
  }
}

function capabilityBody(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: '1',
    runId: RUN,
    purpose: 'capability',
    audience: CAPABILITY_CLAIM.audience,
    bindingId: CAPABILITY_CLAIM.bindingId,
    minimumTtlMs: 125_000,
    ...overrides,
  }
}

const openAiProvider: LlmProvider = {
  id: 'openai',
  name: 'OpenAI',
  envKeys: ['OPENAI_API_KEY'],
  defaultModel: 'gpt-5-mini',
  defaultModels: [],
  isConfigured: (env = process.env) => Boolean(env.OPENAI_API_KEY),
  resolveApiKey: (env = process.env) => env.OPENAI_API_KEY ?? null,
} as unknown as LlmProvider

beforeAll(() => {
  llmProviderRegistry.register(openAiProvider)
})

afterAll(() => {
  llmProviderRegistry.reset()
})

beforeEach(() => {
  jest.clearAllMocks()
  containerResolve.mockImplementation((key: string) => {
    if (key === 'em') return fakeEm()
    throw new Error(`unexpected resolve(${key})`)
  })
  runRows = [
    {
      id: RUN,
      tenantId: TENANT,
      organizationId: ORG,
      agentId: AGENT,
      runtime: 'business-harness',
      status: 'running',
      deletedAt: null,
    },
  ]
  findSessionApiKeyWithSecret.mockResolvedValue({
    key: {
      id: 'api-key-1',
      tenantId: TENANT,
      organizationId: ORG,
      sessionUserId: USER,
      sessionToken: SESSION_TOKEN,
      expiresAt: new Date(Date.now() + 240_000),
    },
    secret: SESSION_SECRET,
  })
})

describe('business harness credential broker', () => {
  it('leases the provider key for the model binding the grant names', async () => {
    const response = await POST(request(modelBody()))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.value).toBe('sk-provider-key-under-test')
    expect(body.type).toBe('api-key')
    expect(body.leaseId).toBe(`run:${RUN}:model:openai`)
    // A lease that outlives the grant would survive the run it was scoped to.
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 210_000)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('leases the caller-scoped MCP key with the session token the harness must inject', async () => {
    const response = await POST(request(capabilityBody()))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.value).toBe(SESSION_SECRET)
    expect(body.metadata).toEqual({ sessionToken: SESSION_TOKEN })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a request without a bearer grant', async () => {
    const response = await POST(request(modelBody(), null))
    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain('sk-provider-key-under-test')
  })

  it('refuses a grant issued for a different run', async () => {
    const other = '55555555-5555-4555-8555-555555555555'
    const response = await POST(request(modelBody({ runId: other }), grant({ runId: RUN })))
    expect(response.status).toBe(403)
  })

  it('answers 503 rather than guessing when the provider has no credential in this process', async () => {
    const previous = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      expect((await POST(request(modelBody()))).status).toBe(503)
    } finally {
      process.env.OPENAI_API_KEY = previous
    }
  })

  it('refuses a purpose whose audience or binding the grant did not authorize', async () => {
    expect((await POST(request(modelBody({ audience: 'model:anthropic' })))).status).toBe(403)
    expect((await POST(request(modelBody({ bindingId: 'om-env-provider:anthropic' })))).status).toBe(403)
    // A model request answered against the capability claim would cross the audiences.
    expect((await POST(request(capabilityBody({ purpose: 'model' })))).status).toBe(403)
  })

  it('refuses to lease anything once the run is no longer running', async () => {
    runRows[0]!.status = 'ok'
    expect((await POST(request(modelBody()))).status).toBe(403)
    expect((await POST(request(capabilityBody()))).status).toBe(403)
  })

  it('refuses a run belonging to another tenant or organization', async () => {
    runRows[0]!.tenantId = '99999999-9999-4999-8999-999999999999'
    expect((await POST(request(modelBody()))).status).toBe(403)

    runRows[0]!.tenantId = TENANT
    runRows[0]!.organizationId = '99999999-9999-4999-8999-999999999999'
    expect((await POST(request(modelBody()))).status).toBe(403)
  })

  it('refuses when the grant expires before the caller says it needs the credential', async () => {
    const response = await POST(request(modelBody({ minimumTtlMs: 290_000 })))
    expect(response.status).toBe(403)
  })

  it('refuses a session key that belongs to another principal', async () => {
    findSessionApiKeyWithSecret.mockResolvedValue({
      key: {
        id: 'api-key-1',
        tenantId: TENANT,
        organizationId: ORG,
        sessionUserId: '99999999-9999-4999-8999-999999999999',
        sessionToken: SESSION_TOKEN,
        expiresAt: new Date(Date.now() + 240_000),
      },
      secret: SESSION_SECRET,
    })
    const response = await POST(request(capabilityBody()))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain(SESSION_SECRET)
  })

  it('refuses a session key that expires before the run deadline', async () => {
    findSessionApiKeyWithSecret.mockResolvedValue({
      key: {
        id: 'api-key-1',
        tenantId: TENANT,
        organizationId: ORG,
        sessionUserId: USER,
        sessionToken: SESSION_TOKEN,
        expiresAt: new Date(Date.now() + 1_000),
      },
      secret: SESSION_SECRET,
    })
    expect((await POST(request(capabilityBody()))).status).toBe(403)
  })

  it('rejects a malformed body before it touches the database', async () => {
    expect((await POST(request({ protocolVersion: '1', runId: RUN }))).status).toBe(422)
    expect((await POST(request(modelBody({ purpose: 'filesystem' })))).status).toBe(422)
    expect((await POST(request(modelBody({ extra: 'not-in-the-contract' })))).status).toBe(422)
  })
})
