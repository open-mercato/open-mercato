/**
 * The unauthenticated provider callback (external-agent-invocation design §5.5;
 * risk R3; tracker task 2.6) — the one publicly reachable surface in this module.
 *
 * What is load-bearing here, in the order an attacker would probe it:
 *
 * 1. **Scope comes from the ROW.** A body or header claiming another tenant is
 *    never consulted. This is R3: a forged "the owner approved" transcript settled
 *    against somebody else's parked workflow.
 * 2. **The raw bytes reach the connector unchanged.** A JSON round-trip anywhere
 *    before `verifyCallback` breaks every provider HMAC, and it is the single
 *    easiest thing in this file to get wrong — so the fake connector below signs
 *    the real bytes rather than trusting a string comparison alone.
 * 3. **Both proofs are required.** An unknown token settles nothing (404, and
 *    nothing about a tenant, run or agent leaks); a known token with a bad
 *    signature settles nothing (401).
 * 4. **Redelivery is normal.** A second callback answers 200 and resumes nothing.
 * 5. **A body is bounded before it is hashed or verified.**
 */

import { createHmac } from 'node:crypto'

const findOneWithDecryptionMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const completeExternalRunMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/runtime/completeExternalRun', () => ({
  completeExternalRun: (...args: unknown[]) => completeExternalRunMock(...args),
}))

const commandBusStub = { execute: jest.fn() }
const containerStub = {
  resolve: (name: string) => {
    if (name === 'em') return { fork: () => ({}) }
    if (name === 'commandBus') return commandBusStub
    // `rateLimiterService` is deliberately absent: the route's `tryResolve` must
    // degrade to "no limiter" rather than failing a legitimate callback.
    throw new Error(`[internal] unregistered test container key "${name}"`)
  },
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => Promise.resolve(containerStub),
}))

import { POST } from '../api/external-runs/[token]/callback/route'
import { hashCallbackToken } from '../lib/runtime/callbackToken'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorScope,
} from '../lib/runtime/externalConnectorRegistry'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '99999999-9999-4999-8999-999999999999'
const ORG_B = '88888888-8888-4888-8888-888888888888'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'

const TOKEN = `xrun_${'a1'.repeat(32)}`
const TOKEN_HASH = hashCallbackToken(TOKEN)
const CONNECTOR_ID = 'test.voice'
const WEBHOOK_SECRET = 'shhh-per-tenant-secret'

/**
 * The bytes a real provider would send: key order and whitespace that no
 * `JSON.stringify(JSON.parse(body))` round-trip reproduces, so a re-serialised
 * body cannot accidentally verify.
 */
const RAW_BODY = '{"zeta":1,\n  "alpha":   {"transcript":"yes, ship it"},"tenant_id":"' + TENANT_B + '"}'

function signBody(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')
}

type ConnectorSpy = {
  verifyCallback: jest.Mock<Promise<boolean>, [Headers, string, ExternalAgentConnectorScope]>
  normalize: jest.Mock<unknown, [unknown]>
}

function registerConnector(overrides: Partial<ExternalAgentConnector> = {}): ConnectorSpy {
  const verifyCallback = jest.fn(
    async (headers: Headers, rawBody: string, _scope: ExternalAgentConnectorScope) =>
      headers.get('x-test-signature') === signBody(rawBody),
  )
  const normalize = jest.fn((raw: unknown) => ({
    kind: 'researcher',
    data: (raw as { alpha?: unknown }).alpha,
  }))
  const connector: ExternalAgentConnector = {
    id: CONNECTOR_ID,
    start: async () => ({ externalRunId: 'conv_1', expectsCallback: true }),
    verifyCallback,
    normalize,
    ...overrides,
  }
  registerExternalAgentConnector(connector)
  return { verifyCallback: verifyCallback as ConnectorSpy['verifyCallback'], normalize }
}

/** The projection the route selects: correlation columns only, no encrypted ones. */
function correlationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    tenantId: TENANT_A,
    organizationId: ORG_A,
    runId: RUN_ID,
    agentId: 'voice.owner_call',
    connectorId: CONNECTOR_ID,
    processId: PROCESS_ID,
    stepId: 'call_owner',
    signalName: 'agent_orchestrator.proposal.ready',
    ...overrides,
  }
}

function callbackRequest(rawBody: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/agent_orchestrator/external-runs/${TOKEN}/callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-signature': signBody(rawBody),
      // A caller asserting somebody else's tenancy in the headers, alongside the
      // `tenant_id` already planted in RAW_BODY. Neither may be consulted.
      'x-om-tenant-id': TENANT_B,
      'x-om-organization-id': ORG_B,
      ...headers,
    },
    body: rawBody,
  })
}

function routeContext(token = TOKEN) {
  return { params: Promise.resolve({ token }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  clearExternalAgentConnectorsForTests()
  delete process.env.OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES
  findOneWithDecryptionMock.mockResolvedValue(correlationRow())
  completeExternalRunMock.mockResolvedValue({
    status: 'completed',
    runId: RUN_ID,
    result: { kind: 'researcher', data: {} },
    outcomeHandle: 'researcher',
    resume: 'sent',
  })
})

afterEach(() => {
  clearExternalAgentConnectorsForTests()
})

describe('external run callback route', () => {
  it('settles a verified callback with the ROW’s scope and answers 200', async () => {
    const connector = registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'completed' })

    // The row was addressed by the token's DIGEST, never the token itself.
    const [, , where] = findOneWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ callbackTokenHash: TOKEN_HASH })

    expect(completeExternalRunMock).toHaveBeenCalledTimes(1)
    const args = completeExternalRunMock.mock.calls[0][0] as {
      scope: { tenantId: string; organizationId: string }
      row: { id: string; tenantId: string; organizationId: string; runId: string }
      settlement: { kind: string; payload: unknown }
    }
    expect(args.scope).toEqual({ tenantId: TENANT_A, organizationId: ORG_A })
    expect(args.row).toMatchObject({ id: ROW_ID, runId: RUN_ID, tenantId: TENANT_A, organizationId: ORG_A })
    expect(args.settlement).toEqual({
      kind: 'result',
      payload: { kind: 'researcher', data: { transcript: 'yes, ship it' } },
    })
    expect(connector.normalize).toHaveBeenCalledTimes(1)
  })

  it('hands the connector the RAW bytes, byte-identical to what was received', async () => {
    const connector = registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    const [headers, rawBody, scope] = connector.verifyCallback.mock.calls[0]
    // Byte-identical: not merely equivalent JSON. A `JSON.parse` → `stringify`
    // round-trip would reorder the keys and drop the whitespace, and every
    // provider HMAC covers exactly these bytes.
    expect(rawBody).toBe(RAW_BODY)
    expect(rawBody).not.toBe(JSON.stringify(JSON.parse(RAW_BODY)))
    // The HMAC the fake connector checks is computed over the real bytes, so this
    // passing is independent proof and not just a string comparison.
    expect(headers.get('x-test-signature')).toBe(signBody(RAW_BODY))
    // And the scope it was asked to verify against is the ROW's, not the headers'.
    expect(scope).toEqual({ tenantId: TENANT_A, organizationId: ORG_A })
  })

  it('ignores a tenant/organization asserted by the body or the headers', async () => {
    registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    const args = completeExternalRunMock.mock.calls[0][0] as {
      scope: { tenantId: string; organizationId: string }
      row: { tenantId: string; organizationId: string }
    }
    // RAW_BODY carries `tenant_id: TENANT_B` and the request headers assert
    // TENANT_B / ORG_B. Neither reaches the settlement.
    expect(args.scope.tenantId).toBe(TENANT_A)
    expect(args.scope.organizationId).toBe(ORG_A)
    expect(args.row.tenantId).toBe(TENANT_A)
    expect(JSON.stringify(args.scope)).not.toContain(TENANT_B)
    expect(JSON.stringify(args.scope)).not.toContain(ORG_B)
  })

  it('answers 404 with no detail for an unknown token, and settles nothing', async () => {
    registerConnector()
    findOneWithDecryptionMock.mockResolvedValue(null)

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(404)
    // Exactly one key, and it names nothing: no tenant, no run, no agent, no hint
    // that the token was well-formed.
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'Not found' })
    const serialized = JSON.stringify(body)
    for (const secret of [TOKEN, TOKEN_HASH, TENANT_A, ORG_A, RUN_ID, ROW_ID, CONNECTOR_ID]) {
      expect(serialized).not.toContain(secret)
    }
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 404 for a token longer than any minted one, without touching the database', async () => {
    registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext('x'.repeat(4096)))

    expect(response.status).toBe(404)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 401 and settles nothing when the connector refuses the signature', async () => {
    const connector = registerConnector()

    const response = await POST(
      callbackRequest(RAW_BODY, { 'x-test-signature': 'deadbeef' }),
      routeContext(),
    )

    expect(response.status).toBe(401)
    expect(connector.verifyCallback).toHaveBeenCalledTimes(1)
    expect(connector.normalize).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('treats a connector that THROWS during verification as unverified', async () => {
    registerConnector({
      verifyCallback: () => {
        throw new Error('signature parser blew up')
      },
    })

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(401)
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 200 to a redelivery and resumes the workflow exactly once', async () => {
    registerConnector()

    // Simulates T2.4's single-shot claim: only the first delivery transitions the
    // row out of `pending`, so only the first one resumes the parked step.
    let resumeCount = 0
    completeExternalRunMock.mockImplementation(async () => {
      if (resumeCount === 0) {
        resumeCount += 1
        return {
          status: 'completed',
          runId: RUN_ID,
          result: { kind: 'researcher', data: {} },
          outcomeHandle: 'researcher',
          resume: 'sent',
        }
      }
      return { status: 'already_settled', runId: RUN_ID }
    })

    const first = await POST(callbackRequest(RAW_BODY), routeContext())
    const second = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ ok: true, status: 'completed' })
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ ok: true, status: 'already_settled' })
    expect(resumeCount).toBe(1)
  })

  it('answers the cross-tenant refusal with the SAME 404 an unknown token gets', async () => {
    registerConnector()
    // The defence-in-depth arm: `completeExternalRun` re-checks the row against the
    // caller scope and refuses. Nothing distinguishes it from a miss.
    completeExternalRunMock.mockResolvedValue({ status: 'scope_denied', runId: RUN_ID })

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })

  it('rejects an oversized body before hashing, lookup or verification', async () => {
    const connector = registerConnector()
    process.env.OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES = '2048'

    const response = await POST(callbackRequest('x'.repeat(50_000)), routeContext())

    expect(response.status).toBe(413)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(connector.verifyCallback).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 503 without settling when no connector is registered for the row', async () => {
    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(503)
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 400 for a verified body that is not JSON, leaving the row pending', async () => {
    const connector = registerConnector()

    const response = await POST(callbackRequest('not json at all'), routeContext())

    expect(response.status).toBe(400)
    expect(connector.verifyCallback).toHaveBeenCalledTimes(1)
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('settles a payload the connector cannot normalize as a connector failure', async () => {
    registerConnector({
      normalize: () => {
        throw new Error('unexpected webhook type')
      },
    })
    completeExternalRunMock.mockResolvedValue({
      status: 'failed',
      runId: RUN_ID,
      cause: 'connector_failure',
      detail: 'unexpected webhook type',
      outcomeHandle: 'error',
      resume: 'sent',
    })

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    // 200: the run IS settled and the parked step woken down the `error` handle.
    // Asking the provider to retry deterministic bytes would achieve nothing.
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'failed' })
    const args = completeExternalRunMock.mock.calls[0][0] as {
      settlement: { kind: string; reason?: string }
    }
    expect(args.settlement.kind).toBe('failure')
    expect(args.settlement.reason).toContain('unexpected webhook type')
  })

  it('never puts the plaintext token in a response body', async () => {
    registerConnector()

    const bodies = await Promise.all([
      POST(callbackRequest(RAW_BODY), routeContext()).then((r) => r.text()),
      POST(callbackRequest(RAW_BODY, { 'x-test-signature': 'nope' }), routeContext()).then((r) => r.text()),
    ])

    for (const body of bodies) {
      expect(body).not.toContain(TOKEN)
      expect(body).not.toContain(TOKEN_HASH)
    }
  })
})
