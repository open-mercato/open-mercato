/** @jest-environment node */
// Data-honesty spec §3.6: a guardrail `block` verdict is a policy decision, not
// a model bug. Both execution routes must map `AgentGuardrailBlockedError`
// BEFORE its parent `AgentOutputInvalidError` and surface the typed reason
// (`code: 'guardrail_blocked'` + kind/phase/set version); a plain invalid
// output keeps the generic 422 shape with no `code`.
import {
  AgentGuardrailBlockedError,
  AgentOutputInvalidError,
} from '../lib/runtime/errors'
import { POST as runPost } from '../api/agents/[id]/run/route'
import { POST as rerunPost } from '../api/runs/[id]/rerun/route'

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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'deals.health_check'
const RUN_ID = '55555555-5555-4555-8555-555555555555'

const blockedError = () =>
  new AgentGuardrailBlockedError(AGENT_ID, '[internal] pre-call guardrail block', {
    phase: 'input',
    kind: 'moderation',
    guardrailSetVersion: 'sha256:test-set',
  })

async function mockAuthAndScope() {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { resolveOrganizationScopeForRequest } = await import(
    '@open-mercato/core/modules/directory/utils/organizationScope'
  )
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
  ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({ selectedId: ORG })
}

async function setupContainer(runError: Error) {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const run = jest.fn(async () => {
    throw runError
  })
  const em = { fork: () => ({ find: jest.fn(async () => []), findOne: jest.fn(async () => null) }) }
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'agentRuntime') return { run }
      if (token === 'em') return em
      return null
    },
  })
  return { run }
}

describe('guardrail-block 422 contract (subclass before parent)', () => {
  beforeEach(() => jest.clearAllMocks())

  const runRequest = () =>
    new Request(`http://localhost/api/agent_orchestrator/agents/${AGENT_ID}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { deal: { id: 'deal-1' } } }),
    })
  const runParams = Promise.resolve({ id: AGENT_ID })

  const rerunRequest = () =>
    new Request(`http://localhost/api/agent_orchestrator/runs/${RUN_ID}/rerun`, { method: 'POST' })
  const rerunParams = Promise.resolve({ id: RUN_ID })

  async function mockRerunSource() {
    const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
      id: RUN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      agentId: AGENT_ID,
      input: { deal: { id: 'deal-1' } },
    })
  }

  it('run route maps AgentGuardrailBlockedError to the typed guardrail_blocked body', async () => {
    await mockAuthAndScope()
    await setupContainer(blockedError())
    const res = await runPost(runRequest(), { params: runParams })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('guardrail_blocked')
    expect(body.kind).toBe('moderation')
    expect(body.phase).toBe('input')
    expect(body.guardrailSetVersion).toBe('sha256:test-set')
    expect(typeof body.error).toBe('string')
  })

  it('run route keeps the generic 422 (no code) for a plain AgentOutputInvalidError', async () => {
    await mockAuthAndScope()
    await setupContainer(new AgentOutputInvalidError(AGENT_ID, 'schema mismatch'))
    const res = await runPost(runRequest(), { params: runParams })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Agent produced invalid output')
    expect(body.code).toBeUndefined()
  })

  it('rerun route maps AgentGuardrailBlockedError to the typed guardrail_blocked body', async () => {
    await mockAuthAndScope()
    await mockRerunSource()
    await setupContainer(blockedError())
    const res = await rerunPost(rerunRequest(), { params: rerunParams })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('guardrail_blocked')
    expect(body.kind).toBe('moderation')
    expect(body.phase).toBe('input')
    expect(body.guardrailSetVersion).toBe('sha256:test-set')
  })

  it('rerun route keeps the generic 422 (no code) for a plain AgentOutputInvalidError', async () => {
    await mockAuthAndScope()
    await mockRerunSource()
    await setupContainer(new AgentOutputInvalidError(AGENT_ID, 'schema mismatch'))
    const res = await rerunPost(rerunRequest(), { params: rerunParams })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Agent produced invalid output')
    expect(body.code).toBeUndefined()
  })
})
