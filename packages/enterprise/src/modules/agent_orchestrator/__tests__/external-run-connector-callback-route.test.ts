/**
 * The STATIC, connector-addressed provider callback (tracker task 2.12) — the
 * route that exists because ElevenLabs configures its post-call webhook at the
 * workspace level and can never be handed a per-run URL.
 *
 * What is load-bearing here, in the order an attacker would probe it:
 *
 * 1. **The signature is the ONLY credential.** The provider id in the body is an
 *    address, not a proof — so the mandatory case is two orgs holding the SAME
 *    `conversation_id`: exactly the correctly-signed one may settle, and the
 *    other must be untouched. That is R3 without a token in front of it.
 * 2. **The raw bytes reach the connector unchanged.** This route must parse to
 *    find the address, which is the one thing that could plausibly re-serialise a
 *    body. The fake connector therefore verifies a real HMAC over the real bytes,
 *    and a re-serialised body is asserted to FAIL it.
 * 3. **Opting in is explicit.** A connector without `extractExternalRunId` is not
 *    addressable this way and gets the same 404 an unknown connector gets.
 * 4. **Nothing settles without a verifying candidate**, including when the
 *    connector throws while verifying.
 * 5. **Redelivery is normal**, and a body is bounded before anything else.
 */

import { createHmac } from 'node:crypto'

const findWithDecryptionMock = jest.fn<Promise<unknown[]>, unknown[]>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
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

import { POST } from '../api/external-runs/connectors/[connectorId]/callback/route'
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
const RUN_ID_A = '55555555-5555-4555-8555-555555555555'
const RUN_ID_B = '77777777-7777-4777-8777-777777777777'
const ROW_ID_A = '66666666-6666-4666-8666-666666666666'
const ROW_ID_B = '44444444-4444-4444-8444-444444444444'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'

const CONNECTOR_ID = 'test.voice'
const CONVERSATION_ID = 'conv_01jabcXYZ'

/** Per-TENANT webhook secrets — the whole reason the signature can disambiguate. */
const SECRETS: Record<string, string> = {
  [ORG_A]: 'org-a-webhook-secret',
  [ORG_B]: 'org-b-webhook-secret',
}

/**
 * The bytes a real provider would send: key order and whitespace that no
 * `JSON.stringify(JSON.parse(body))` round-trip reproduces, so a re-serialised
 * body cannot accidentally verify. The tenancy planted in the body is the one a
 * forger would hope the route reads.
 */
const RAW_BODY =
  '{"type":"post_call_transcription",\n  "data":   {"conversation_id":"'
  + CONVERSATION_ID
  + '","transcript":"yes, ship it"},"tenant_id":"'
  + TENANT_B
  + '"}'

function signBody(rawBody: string, organizationId: string): string {
  return createHmac('sha256', SECRETS[organizationId] ?? 'unknown').update(rawBody).digest('hex')
}

type ConnectorSpy = {
  verifyCallback: jest.Mock<Promise<boolean>, [Headers, string, ExternalAgentConnectorScope]>
  normalize: jest.Mock<unknown, [unknown]>
  extractExternalRunId: jest.Mock<string | null, [unknown]>
}

/**
 * A connector that behaves like a real one: it verifies an HMAC computed with
 * the secret of the tenant it was ASKED about, so a candidate loop that passed
 * the wrong scope would fail these tests rather than pass them.
 */
function registerConnector(overrides: Partial<ExternalAgentConnector> = {}): ConnectorSpy {
  const verifyCallback = jest.fn(
    async (headers: Headers, rawBody: string, scope: ExternalAgentConnectorScope) =>
      headers.get('x-test-signature') === signBody(rawBody, scope.organizationId),
  )
  const normalize = jest.fn((raw: unknown) => ({
    kind: 'researcher',
    data: (raw as { data?: unknown }).data,
  }))
  const extractExternalRunId = jest.fn(
    (raw: unknown) => (raw as { data?: { conversation_id?: string } })?.data?.conversation_id ?? null,
  )
  const connector: ExternalAgentConnector = {
    id: CONNECTOR_ID,
    start: async () => ({ externalRunId: CONVERSATION_ID, expectsCallback: true }),
    verifyCallback,
    normalize,
    extractExternalRunId,
    ...overrides,
  }
  registerExternalAgentConnector(connector)
  return {
    verifyCallback: verifyCallback as ConnectorSpy['verifyCallback'],
    normalize,
    extractExternalRunId: extractExternalRunId as ConnectorSpy['extractExternalRunId'],
  }
}

/** The projection the route selects: correlation columns only, no encrypted ones. */
function correlationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID_A,
    tenantId: TENANT_A,
    organizationId: ORG_A,
    runId: RUN_ID_A,
    agentId: 'voice.owner_call',
    connectorId: CONNECTOR_ID,
    status: 'pending',
    processId: PROCESS_ID,
    stepId: 'call_owner',
    signalName: 'agent_orchestrator.proposal.ready',
    createdAt: new Date('2026-08-12T10:00:00.000Z'),
    ...overrides,
  }
}

/** The SAME provider conversation id, held by a second tenant on its own workspace. */
function foreignCorrelationRow(overrides: Record<string, unknown> = {}) {
  return correlationRow({
    id: ROW_ID_B,
    tenantId: TENANT_B,
    organizationId: ORG_B,
    runId: RUN_ID_B,
    createdAt: new Date('2026-08-12T11:00:00.000Z'),
    ...overrides,
  })
}

function callbackRequest(
  rawBody: string,
  options: { signAs?: string; headers?: Record<string, string> } = {},
): Request {
  const signAs = options.signAs ?? ORG_A
  return new Request(
    `http://localhost/api/agent_orchestrator/external-runs/connectors/${CONNECTOR_ID}/callback`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-signature': signBody(rawBody, signAs),
        // A caller asserting somebody else's tenancy in the headers, alongside the
        // `tenant_id` already planted in RAW_BODY. Neither may be consulted.
        'x-om-tenant-id': TENANT_B,
        'x-om-organization-id': ORG_B,
        ...(options.headers ?? {}),
      },
      body: rawBody,
    },
  )
}

function routeContext(connectorId = CONNECTOR_ID) {
  return { params: Promise.resolve({ connectorId }) }
}

function settlementArgs() {
  return completeExternalRunMock.mock.calls[0][0] as {
    scope: { tenantId: string; organizationId: string }
    row: { id: string; tenantId: string; organizationId: string; runId: string }
    settlement: { kind: string; payload?: unknown; reason?: string }
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  clearExternalAgentConnectorsForTests()
  delete process.env.OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES
  findWithDecryptionMock.mockResolvedValue([correlationRow()])
  completeExternalRunMock.mockResolvedValue({
    status: 'completed',
    runId: RUN_ID_A,
    result: { kind: 'researcher', data: {} },
    outcomeHandle: 'researcher',
    resume: 'sent',
  })
})

afterEach(() => {
  clearExternalAgentConnectorsForTests()
})

describe('connector-addressed external run callback route', () => {
  it('settles a verified callback with the ROW’s scope and answers 200', async () => {
    const connector = registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'completed' })

    // The row was addressed by the connector-extracted provider id, scoped to the
    // connector from the PATH — never a connector named in the body.
    const [, , where] = findWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ connectorId: CONNECTOR_ID, externalRunId: CONVERSATION_ID })
    expect(connector.extractExternalRunId).toHaveBeenCalledTimes(1)

    const args = settlementArgs()
    expect(args.scope).toEqual({ tenantId: TENANT_A, organizationId: ORG_A })
    expect(args.row).toMatchObject({ id: ROW_ID_A, runId: RUN_ID_A, tenantId: TENANT_A })
    expect(args.settlement.kind).toBe('result')
  })

  describe('two organizations holding the same conversation id', () => {
    beforeEach(() => {
      // Both tenants run their own ElevenLabs workspace, and both minted the same
      // `conversation_id`. T2.1's unique is per-org, so this is legal data.
      findWithDecryptionMock.mockResolvedValue([foreignCorrelationRow(), correlationRow()])
    })

    it('settles ONLY the organization whose secret signed the body', async () => {
      const connector = registerConnector()

      const response = await POST(callbackRequest(RAW_BODY, { signAs: ORG_A }), routeContext())

      expect(response.status).toBe(200)
      expect(completeExternalRunMock).toHaveBeenCalledTimes(1)
      const args = settlementArgs()
      expect(args.scope).toEqual({ tenantId: TENANT_A, organizationId: ORG_A })
      expect(args.row.id).toBe(ROW_ID_A)
      // Org B's run is untouched: it is never named in the settlement at all.
      expect(JSON.stringify(args)).not.toContain(ROW_ID_B)
      expect(JSON.stringify(args)).not.toContain(RUN_ID_B)
      expect(JSON.stringify(args)).not.toContain(ORG_B)
      // Every candidate was verified against its OWN tenancy, never a shared one.
      const scopes = connector.verifyCallback.mock.calls.map(([, , scope]) => scope.organizationId)
      expect(new Set(scopes).size).toBe(scopes.length)
      expect(scopes).toContain(ORG_A)
    })

    it('settles the OTHER organization when the OTHER secret signed the body', async () => {
      registerConnector()

      const response = await POST(callbackRequest(RAW_BODY, { signAs: ORG_B }), routeContext())

      expect(response.status).toBe(200)
      expect(completeExternalRunMock).toHaveBeenCalledTimes(1)
      const args = settlementArgs()
      // The mirror image of the case above — proving the route follows the
      // SIGNATURE and not the row order, the newest row or the body's claim.
      expect(args.scope).toEqual({ tenantId: TENANT_B, organizationId: ORG_B })
      expect(args.row.id).toBe(ROW_ID_B)
    })

    it('settles NOTHING when neither organization’s secret signed the body', async () => {
      const connector = registerConnector()

      const response = await POST(
        callbackRequest(RAW_BODY, { headers: { 'x-test-signature': 'deadbeef' } }),
        routeContext(),
      )

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Callback verification failed' })
      expect(connector.verifyCallback).toHaveBeenCalledTimes(2)
      expect(connector.normalize).not.toHaveBeenCalled()
      expect(completeExternalRunMock).not.toHaveBeenCalled()
    })
  })

  it('hands the connector the RAW bytes, byte-identical to what was received', async () => {
    const connector = registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    const [headers, rawBody, scope] = connector.verifyCallback.mock.calls[0]
    // Byte-identical: not merely equivalent JSON. This route MUST parse the body
    // to find its address, so re-serialising on the way to the verifier is the one
    // mistake that would silently break every provider HMAC.
    expect(rawBody).toBe(RAW_BODY)
    const reserialized = JSON.stringify(JSON.parse(RAW_BODY))
    expect(rawBody).not.toBe(reserialized)
    // And the re-serialised body genuinely does NOT verify — so the assertion
    // above is a real signature property, not just a string comparison.
    expect(signBody(reserialized, ORG_A)).not.toBe(signBody(RAW_BODY, ORG_A))
    expect(headers.get('x-test-signature')).toBe(signBody(RAW_BODY, ORG_A))
    expect(scope).toEqual({ tenantId: TENANT_A, organizationId: ORG_A })
  })

  it('ignores a tenant/organization asserted by the body or the headers', async () => {
    registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    const args = settlementArgs()
    expect(args.scope).toEqual({ tenantId: TENANT_A, organizationId: ORG_A })
    expect(JSON.stringify(args.scope)).not.toContain(TENANT_B)
    expect(JSON.stringify(args.scope)).not.toContain(ORG_B)
  })

  it('answers 404 with no detail for an unknown conversation id, and settles nothing', async () => {
    registerConnector()
    findWithDecryptionMock.mockResolvedValue([])

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(404)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'Not found' })
    const serialized = JSON.stringify(body)
    for (const detail of [CONVERSATION_ID, TENANT_A, ORG_A, RUN_ID_A, ROW_ID_A, CONNECTOR_ID]) {
      expect(serialized).not.toContain(detail)
    }
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown connector without touching the database', async () => {
    registerConnector()

    const response = await POST(callbackRequest(RAW_BODY), routeContext('nobody.registered'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 404 for a connector that does not implement extractExternalRunId', async () => {
    // A token-addressed connector never opted in to this entry point. Same body as
    // an unknown connector, so the route is not a probe for what is deployed.
    const connector: ExternalAgentConnector = {
      id: CONNECTOR_ID,
      start: async () => ({ externalRunId: CONVERSATION_ID, expectsCallback: true }),
      verifyCallback: () => true,
      normalize: (raw) => raw,
    }
    registerExternalAgentConnector(connector)

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the connector cannot address the payload', async () => {
    const connector = registerConnector()
    const body = '{"type":"workspace_ping","data":{}}'

    const response = await POST(callbackRequest(body), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Callback carries no external run id' })
    expect(connector.extractExternalRunId).toHaveBeenCalledTimes(1)
    // No row was even searched for: an unaddressable payload is a request defect.
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('treats an extractor that THROWS as unaddressable rather than a 500', async () => {
    registerConnector({
      extractExternalRunId: () => {
        throw new Error('unexpected payload shape')
      },
    })

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(400)
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that is not JSON', async () => {
    const connector = registerConnector()

    const response = await POST(callbackRequest('not json at all'), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' })
    expect(connector.extractExternalRunId).not.toHaveBeenCalled()
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

  it('lets one candidate’s broken verifier not deny another candidate’s valid callback', async () => {
    findWithDecryptionMock.mockResolvedValue([foreignCorrelationRow(), correlationRow()])
    registerConnector({
      verifyCallback: async (headers, rawBody, scope) => {
        // Org B's credentials are broken; org A's callback must still settle.
        if (scope.organizationId === ORG_B) throw new Error('credential record is corrupt')
        return headers.get('x-test-signature') === signBody(rawBody, scope.organizationId)
      },
    })

    const response = await POST(callbackRequest(RAW_BODY, { signAs: ORG_A }), routeContext())

    expect(response.status).toBe(200)
    expect(settlementArgs().row.id).toBe(ROW_ID_A)
  })

  it('answers 200 to a redelivery and resumes the workflow exactly once', async () => {
    registerConnector()
    // A settled row is still a CANDIDATE — a 404 here would make the provider
    // retry a finished run forever.
    findWithDecryptionMock.mockResolvedValue([correlationRow({ status: 'completed' })])

    let resumeCount = 0
    completeExternalRunMock.mockImplementation(async () => {
      if (resumeCount === 0) {
        resumeCount += 1
        return {
          status: 'completed',
          runId: RUN_ID_A,
          result: { kind: 'researcher', data: {} },
          outcomeHandle: 'researcher',
          resume: 'sent',
        }
      }
      return { status: 'already_settled', runId: RUN_ID_A }
    })

    const first = await POST(callbackRequest(RAW_BODY), routeContext())
    const second = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ ok: true, status: 'already_settled' })
    expect(resumeCount).toBe(1)
  })

  it('rejects an oversized body before extraction, lookup or verification', async () => {
    const connector = registerConnector()
    process.env.OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES = '2048'

    const response = await POST(callbackRequest('x'.repeat(50_000)), routeContext())

    expect(response.status).toBe(413)
    expect(connector.extractExternalRunId).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(connector.verifyCallback).not.toHaveBeenCalled()
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('caps how many candidates one provider id can make it verify', async () => {
    const connector = registerConnector()

    await POST(callbackRequest(RAW_BODY), routeContext())

    // The cap is enforced in SQL, so the verification work per request is bounded
    // by the query and never by how many rows happen to share an id.
    const [, , , options] = findWithDecryptionMock.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { limit?: number },
    ]
    expect(options.limit).toBeLessThanOrEqual(10)
    expect(connector.verifyCallback.mock.calls.length).toBeLessThanOrEqual(options.limit ?? 0)
  })

  it('answers the cross-tenant refusal with the SAME 404 an unknown id gets', async () => {
    registerConnector()
    completeExternalRunMock.mockResolvedValue({ status: 'scope_denied', runId: RUN_ID_A })

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
  })

  it('settles a payload the connector cannot normalize as a connector failure', async () => {
    registerConnector({
      normalize: () => {
        throw new Error('unexpected webhook type')
      },
    })
    completeExternalRunMock.mockResolvedValue({
      status: 'failed',
      runId: RUN_ID_A,
      cause: 'connector_failure',
      detail: 'unexpected webhook type',
      outcomeHandle: 'error',
      resume: 'sent',
    })

    const response = await POST(callbackRequest(RAW_BODY), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'failed' })
    const args = settlementArgs()
    expect(args.settlement.kind).toBe('failure')
    expect(args.settlement.reason).toContain('unexpected webhook type')
  })

  it('never echoes the payload or the provider id into a response body', async () => {
    registerConnector()

    const bodies = await Promise.all([
      POST(callbackRequest(RAW_BODY), routeContext()).then((r) => r.text()),
      POST(callbackRequest(RAW_BODY, { headers: { 'x-test-signature': 'nope' } }), routeContext())
        .then((r) => r.text()),
    ])

    for (const body of bodies) {
      expect(body).not.toContain(CONVERSATION_ID)
      expect(body).not.toContain('yes, ship it')
      expect(body).not.toContain(SECRETS[ORG_A])
    }
  })
})
