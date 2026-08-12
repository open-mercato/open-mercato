/**
 * THE LOOP, END TO END, THROUGH THE PLATFORM'S OWN PER-RUN CALLBACK ROUTE.
 *
 * Every other test in this package exercises one half of the connector in
 * isolation. This one wires the real pieces together and is the reason the
 * package exists:
 *
 *   connector.start()  →  the provider is handed a per-run callback URL
 *   (the provider)     →  POSTs a signed answer to that exact URL
 *   the REAL route     →  `api/external-runs/[token]/callback` resolves the run by
 *                         the token's digest, asks THIS connector to verify and
 *                         normalize, and settles
 *
 * That token-addressed route is the design's PRIMARY entry point and, until this
 * connector existed, no shipped connector could reach it: `agent_elevenlabs` has
 * to be settled through the static, connector-addressed route, because ElevenLabs
 * configures its webhook destination at the workspace level. So this file is what
 * proves the primary route works with a real provider package on the other end,
 * rather than with a fake connector defined inside the orchestrator's own tests.
 *
 * It also exercises the container seam: nothing here passes credentials to the
 * connector. The route hands its own container to `verifyCallback` and
 * `normalize`, the package's real credential reader resolves
 * `integrationCredentialsService` from it, and the tenant's stored record is what
 * decides both the signature scheme and where the answer lives.
 */

const findOneWithDecryptionMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const completeExternalRunMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock(
  '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/completeExternalRun',
  () => ({
    completeExternalRun: (...args: unknown[]) => completeExternalRunMock(...args),
  }),
)

/**
 * The tenant's stored integration record — the ONLY place the connector's
 * behaviour is configured. Mutated per test to prove that behaviour follows it.
 */
let storedCredentials: Record<string, unknown> = {}
const credentialsService = {
  resolve: jest.fn(async () => storedCredentials),
}

const containerStub = {
  resolve: (name: string) => {
    if (name === 'em') return { fork: () => ({}) }
    if (name === 'commandBus') return { execute: jest.fn() }
    if (name === 'integrationCredentialsService') return credentialsService
    // `rateLimiterService` is deliberately absent: the route degrades to "no
    // limiter" rather than failing a legitimate callback.
    throw new Error(`[internal] unregistered test container key "${name}"`)
  },
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => Promise.resolve(containerStub),
}))

import { z } from 'zod'
import { POST } from '@open-mercato/enterprise/modules/agent_orchestrator/api/external-runs/[token]/callback/route'
import {
  buildExternalRunCallbackPath,
  hashCallbackToken,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/callbackToken'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import type { AgentRegistryEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { createGenericHttpConnector, GENERIC_HTTP_CONNECTOR_ID } from '../lib/connector'
import { createGenericHttpCredentialsReader } from '../lib/credentialsReader'
import { buildSignatureHeaderValue } from '../lib/signature'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'

const CALLBACK_TOKEN = `xrun_${'b2'.repeat(32)}`
const APP_ORIGIN = 'https://mercato.example.com'
const SIGNING_SECRET = 'whsec_the_tenants_callback_signing_secret'
const AUTH_VALUE = 'Bearer sk_live_the_tenants_provider_key'

/**
 * The provider's answer, with key order and whitespace that no
 * `JSON.stringify(JSON.parse(body))` round trip reproduces — so a route or
 * connector that re-serialised before verifying could not accidentally pass.
 */
const PROVIDER_BODY =
  '{"status":"done",\n  "result":   {"answer":"They still intend to renew, but want a call first."},"runId":"run_9001"}'

function baseCredentials(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startUrl: 'https://provider.example.com/v1/runs',
    authHeaderValue: AUTH_VALUE,
    signingSecret: SIGNING_SECRET,
    signatureHeader: 'x-provider-signature',
    signatureScheme: 'hex',
    resultPath: 'result.answer',
    externalRunIdPath: 'runId',
    requestTemplate: JSON.stringify({
      question: '{{input.brief}}',
      webhook: { url: '{{callbackUrl}}', token: '{{callbackToken}}' },
    }),
    ...overrides,
  }
}

function correlationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    runId: RUN_ID,
    agentId: 'http.remote_researcher',
    connectorId: GENERIC_HTTP_CONNECTOR_ID,
    processId: PROCESS_ID,
    stepId: 'ask_remote_service',
    signalName: 'agent_orchestrator.proposal.ready',
    ...overrides,
  }
}

function agentEntry(): AgentRegistryEntry {
  return {
    id: 'http.remote_researcher',
    moduleId: 'agent_http',
    resultKind: 'researcher',
    schema: z.object({ kind: z.literal('researcher'), data: z.object({ answer: z.string() }) }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Ask a remote HTTP service',
    description: 'test entry',
    instructions: '',
    runtime: 'external',
    connectorId: GENERIC_HTTP_CONNECTOR_ID,
    callbackTimeoutMs: 30 * 60 * 1000,
  }
}

/** The connector exactly as `di.ts` registers it: the REAL credential reader. */
function registerRealConnector(fetchImpl?: typeof fetch) {
  registerExternalAgentConnector(
    createGenericHttpConnector({
      readCredentials: createGenericHttpCredentialsReader(),
      fetchImpl,
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
    }),
  )
}

async function postCallback(args: {
  token: string
  rawBody: string
  signatureHeader?: string
  signature?: string
}): Promise<Response> {
  const path = buildExternalRunCallbackPath(args.token)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (args.signature !== undefined) {
    headers.set(args.signatureHeader ?? 'x-provider-signature', args.signature)
  }
  const request = new Request(`${APP_ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: args.rawBody,
  })
  return POST(request, { params: Promise.resolve({ token: args.token }) })
}

beforeEach(() => {
  clearExternalAgentConnectorsForTests()
  findOneWithDecryptionMock.mockReset()
  completeExternalRunMock.mockReset()
  completeExternalRunMock.mockResolvedValue({ status: 'completed' })
  credentialsService.resolve.mockClear()
  storedCredentials = baseCredentials()
})

describe('start → per-run callback → settle', () => {
  it('settles the run the provider was told to call back on', async () => {
    // 1. START. Nothing but the tenant's stored record configures this.
    const requests: { url: string; body: unknown }[] = []
    const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
      requests.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ runId: 'run_9001' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    registerRealConnector(fetchImpl)

    const connector = createGenericHttpConnector({
      readCredentials: createGenericHttpCredentialsReader(),
      fetchImpl,
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
    })
    const started = await connector.start({
      agentEntry: agentEntry(),
      input: { brief: 'Is the ACME renewal still on?' },
      callbackUrl: `${APP_ORIGIN}${buildExternalRunCallbackPath(CALLBACK_TOKEN)}`,
      callbackToken: CALLBACK_TOKEN,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      container: containerStub,
    })
    expect(started.externalRunId).toBe('run_9001')

    // 2. THE PROVIDER CALLS BACK on the URL it was given — the token is taken from
    //    the request body it received, never from the test's own constant, so a
    //    connector that sent the wrong URL could not pass this.
    const sentBody = requests[0].body as { webhook: { url: string } }
    const sentPath = new URL(sentBody.webhook.url).pathname
    const tokenFromProvider = decodeURIComponent(sentPath.split('/').filter(Boolean).at(-2) ?? '')
    expect(tokenFromProvider).toBe(CALLBACK_TOKEN)

    // The correlation row the runner would have written: only the token's DIGEST
    // is stored, and that is what the route looks up by.
    findOneWithDecryptionMock.mockImplementation(async (_em, _entity, where) => {
      const filter = where as { callbackTokenHash?: string }
      return filter.callbackTokenHash === hashCallbackToken(CALLBACK_TOKEN)
        ? correlationRow()
        : null
    })

    const response = await postCallback({
      token: tokenFromProvider,
      rawBody: PROVIDER_BODY,
      signature: buildSignatureHeaderValue({
        rawBody: PROVIDER_BODY,
        secret: SIGNING_SECRET,
        scheme: 'hex',
      }),
    })

    // 3. SETTLED, with the answer read at the tenant's configured path.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'completed' })
    expect(completeExternalRunMock).toHaveBeenCalledTimes(1)
    const settled = completeExternalRunMock.mock.calls[0][0] as {
      scope: { tenantId: string; organizationId: string }
      row: { runId: string; stepId: string | null }
      settlement: { kind: string; payload: unknown }
    }
    expect(settled.settlement).toEqual({
      kind: 'result',
      payload: {
        kind: 'researcher',
        data: { answer: 'They still intend to renew, but want a call first.' },
      },
    })
    // Scope comes from the ROW, and the parked step travels with it.
    expect(settled.scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(settled.row.runId).toBe(RUN_ID)
    expect(settled.row.stepId).toBe('ask_remote_service')
  })

  it('follows the tenant credential for BOTH the scheme and the result path', async () => {
    // The same route, the same connector, the same payload — a different tenant
    // record, and a different reading. This is what "configurable through
    // credentials alone" has to mean.
    storedCredentials = baseCredentials({
      signatureScheme: 'sha256_prefix',
      signatureHeader: 'x-hub-signature-256',
      resultPath: 'data.0.output',
    })
    registerRealConnector()
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())

    const rawBody = '{"data":[{"output":"answered elsewhere"}]}'
    const response = await postCallback({
      token: CALLBACK_TOKEN,
      rawBody,
      signatureHeader: 'x-hub-signature-256',
      signature: buildSignatureHeaderValue({
        rawBody,
        secret: SIGNING_SECRET,
        scheme: 'sha256_prefix',
      }),
    })

    expect(response.status).toBe(200)
    const settled = completeExternalRunMock.mock.calls[0][0] as {
      settlement: { payload: unknown }
    }
    expect(settled.settlement.payload).toEqual({
      kind: 'researcher',
      data: { answer: 'answered elsewhere' },
    })
  })

  it('reads the credentials through the ROUTE\'s container, building none of its own', async () => {
    registerRealConnector()
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())

    await postCallback({
      token: CALLBACK_TOKEN,
      rawBody: PROVIDER_BODY,
      signature: buildSignatureHeaderValue({
        rawBody: PROVIDER_BODY,
        secret: SIGNING_SECRET,
        scheme: 'hex',
      }),
    })

    // Once to verify, once to normalize — both under the ROW's tenancy, which is
    // the only scope either entry point is given.
    expect(credentialsService.resolve).toHaveBeenCalledTimes(2)
    expect(credentialsService.resolve).toHaveBeenCalledWith('agent_http', {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })
})

describe('the route refuses what it should', () => {
  beforeEach(() => {
    registerRealConnector()
  })

  it('rejects a body signed with another secret, and settles nothing', async () => {
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())
    const response = await postCallback({
      token: CALLBACK_TOKEN,
      rawBody: PROVIDER_BODY,
      signature: buildSignatureHeaderValue({
        rawBody: PROVIDER_BODY,
        secret: 'whsec_some_other_tenants_secret',
        scheme: 'hex',
      }),
    })
    expect(response.status).toBe(401)
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('rejects a body tampered with after signing', async () => {
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())
    const signature = buildSignatureHeaderValue({
      rawBody: PROVIDER_BODY,
      secret: SIGNING_SECRET,
      scheme: 'hex',
    })
    const response = await postCallback({
      token: CALLBACK_TOKEN,
      rawBody: PROVIDER_BODY.replace('still intend to renew', 'have cancelled'),
      signature,
    })
    expect(response.status).toBe(401)
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('rejects an unsigned callback', async () => {
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())
    const response = await postCallback({ token: CALLBACK_TOKEN, rawBody: PROVIDER_BODY })
    expect(response.status).toBe(401)
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('answers 404 for a token that addresses no run, revealing nothing', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const response = await postCallback({
      token: `xrun_${'cc'.repeat(32)}`,
      rawBody: PROVIDER_BODY,
      signature: buildSignatureHeaderValue({
        rawBody: PROVIDER_BODY,
        secret: SIGNING_SECRET,
        scheme: 'hex',
      }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(completeExternalRunMock).not.toHaveBeenCalled()
  })

  it('settles a verified payload it cannot map as a connector FAILURE, not a hang', async () => {
    // The path is deterministic, so redelivering the same bytes cannot help. Waking
    // the step down `error` now beats parking it until the deadline sweep.
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())
    const rawBody = '{"status":"done","result":{}}'
    const response = await postCallback({
      token: CALLBACK_TOKEN,
      rawBody,
      signature: buildSignatureHeaderValue({ rawBody, secret: SIGNING_SECRET, scheme: 'hex' }),
    })

    expect(response.status).toBe(200)
    const settled = completeExternalRunMock.mock.calls[0][0] as {
      settlement: { kind: string; reason?: string }
    }
    expect(settled.settlement.kind).toBe('failure')
    expect(settled.settlement.reason).toContain('result.answer')
  })

  it('reports a redelivery as already settled, without resuming twice', async () => {
    findOneWithDecryptionMock.mockResolvedValue(correlationRow())
    completeExternalRunMock.mockResolvedValue({ status: 'already_settled' })
    const response = await postCallback({
      token: CALLBACK_TOKEN,
      rawBody: PROVIDER_BODY,
      signature: buildSignatureHeaderValue({
        rawBody: PROVIDER_BODY,
        secret: SIGNING_SECRET,
        scheme: 'hex',
      }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: 'already_settled' })
  })
})
