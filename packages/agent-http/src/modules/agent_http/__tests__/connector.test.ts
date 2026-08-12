/**
 * The start half of the generic connector, plus the four refusals that are the
 * reason it is safe to point at an operator-supplied URL.
 *
 * What is load-bearing here:
 *
 *  1. **The provider is handed the PER-RUN callback URL and token.** That is the
 *     whole difference from the voice connector, which could only be settled
 *     through the static connector-addressed route: here the platform's primary,
 *     token-addressed route is genuinely reachable.
 *  2. **SSRF.** The target URL is operator-configured, so it goes through the same
 *     shared guard `CALL_WEBHOOK` uses, and a private or loopback target is refused
 *     before any request is made.
 *  3. **No secret reaches a thrown error.** A provider error body can echo the
 *     request's own auth header back, and that string is persisted on the run and
 *     rendered in the cockpit.
 *  4. **A profile fails closed**, because the callback half of the seam is
 *     addressed per tenant and could not follow a per-agent endpoint.
 */

import { z } from 'zod'
import type { AgentRegistryEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import type {
  ExternalAgentConnectorScope,
  ExternalAgentConnectorStartArgs,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import { buildExternalRunCallbackPath } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/callbackToken'
import { createGenericHttpConnector, GENERIC_HTTP_CONNECTOR_ID } from '../lib/connector'
import type { GenericHttpCredentials } from '../lib/credentials'

const SCOPE: ExternalAgentConnectorScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const AUTH_VALUE = 'Bearer sk_live_this_is_the_tenants_api_key'
const SIGNING_SECRET = 'whsec_this_is_the_tenants_signing_secret'

const CALLBACK_TOKEN = `xrun_${'a1'.repeat(32)}`
const CALLBACK_URL = `https://mercato.example.com${buildExternalRunCallbackPath(CALLBACK_TOKEN)}`

function credentials(overrides: Partial<GenericHttpCredentials> = {}): GenericHttpCredentials {
  return {
    startUrl: 'https://provider.example.com/v1/runs',
    authHeaderName: 'Authorization',
    authHeaderValue: AUTH_VALUE,
    signingSecret: SIGNING_SECRET,
    signatureHeader: 'x-om-signature',
    signatureScheme: 'hex',
    resultPath: 'result.answer',
    externalRunIdPath: 'id',
    requestTemplate: {
      question: '{{input.brief}}',
      context: '{{input.payload}}',
      webhook: { url: '{{callbackUrl}}', token: '{{callbackToken}}' },
    },
    ...overrides,
  }
}

/** A registry entry shaped exactly as `defineExternalAgent` produces one. */
function agentEntry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
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
    ...overrides,
  }
}

type RecordedRequest = { url: string; init: RequestInit }

/**
 * A fetch stub that also stands in for the network: nothing here opens a socket,
 * and `lookupHost` below keeps the URL guard from performing a real DNS lookup.
 */
function stubFetch(response: {
  status?: number
  body?: unknown
  bodyText?: string
  headers?: Record<string, string>
}): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(url), init })
    const text = response.bodyText ?? JSON.stringify(response.body ?? {})
    return new Response(text, {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json', ...(response.headers ?? {}) },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

function startArgs(overrides: Partial<ExternalAgentConnectorStartArgs> = {}): ExternalAgentConnectorStartArgs {
  return {
    agentEntry: agentEntry(),
    input: { brief: 'Is the ACME renewal still on?', payload: { accountId: 'acc_4211' } },
    callbackUrl: CALLBACK_URL,
    callbackToken: CALLBACK_TOKEN,
    scope: SCOPE,
    ...overrides,
  }
}

describe('generic HTTP connector — start', () => {
  it('POSTs the templated body, including the per-run callback URL and token', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })

    const started = await connector.start(startArgs())

    expect(started).toEqual({ externalRunId: 'run_9001', expectsCallback: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://provider.example.com/v1/runs')
    expect(requests[0].init.method).toBe('POST')

    const sent = JSON.parse(String(requests[0].init.body))
    expect(sent).toEqual({
      question: 'Is the ACME renewal still on?',
      // A value that is exactly one placeholder keeps its TYPE — the object is
      // forwarded, not its JSON text.
      context: { accountId: 'acc_4211' },
      webhook: { url: CALLBACK_URL, token: CALLBACK_TOKEN },
    })

    const headers = new Headers(requests[0].init.headers as HeadersInit)
    expect(headers.get('authorization')).toBe(AUTH_VALUE)
    expect(headers.get('content-type')).toBe('application/json')
    // Never followed: a redirect target is not what the guard validated.
    expect(requests[0].init.redirect).toBe('manual')
  })

  it('sends the callback URL the platform would actually serve', async () => {
    // The URL the provider is handed must be the one the `[token]` route resolves;
    // a drift between the minting and the routing is only discovered when a real
    // callback 404s.
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await connector.start(startArgs())

    const sent = JSON.parse(String(requests[0].init.body))
    expect(new URL(sent.webhook.url).pathname).toBe(buildExternalRunCallbackPath(CALLBACK_TOKEN))
    expect(sent.webhook.url).toContain(CALLBACK_TOKEN)
  })

  it('uses the container it was handed rather than building one', async () => {
    const containerStub = { resolve: () => undefined }
    const readCredentials = jest.fn(async () => credentials())
    const { fetchImpl } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({ readCredentials, fetchImpl, lookupHost: publicLookup })

    await connector.start(startArgs({ container: containerStub }))

    expect(readCredentials).toHaveBeenCalledWith(SCOPE, containerStub)
  })

  it('falls back to the default template when the tenant configured none', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () =>
        credentials({
          requestTemplate: {
            input: '{{input}}',
            callbackUrl: '{{callbackUrl}}',
            callbackToken: '{{callbackToken}}',
          },
        }),
      fetchImpl,
      lookupHost: publicLookup,
    })

    await connector.start(startArgs())
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      input: { brief: 'Is the ACME renewal still on?', payload: { accountId: 'acc_4211' } },
      callbackUrl: CALLBACK_URL,
      callbackToken: CALLBACK_TOKEN,
    })
  })

  it('sends no auth header when the tenant configured no value', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials({ authHeaderValue: null }),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await connector.start(startArgs())
    expect(new Headers(requests[0].init.headers as HeadersInit).get('authorization')).toBeNull()
  })

  it('reads the provider run id from the configured path, including a numeric one', async () => {
    const { fetchImpl } = stubFetch({ body: { data: { runId: 4211 } } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials({ externalRunIdPath: 'data.runId' }),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await expect(connector.start(startArgs())).resolves.toEqual({
      externalRunId: '4211',
      expectsCallback: true,
    })
  })

  it('fails the start when the response carries no external run id', async () => {
    // Suspending here would park a workflow on a request whose fate nobody can
    // look up, cancel or reconcile.
    const { fetchImpl } = stubFetch({ body: { accepted: true } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await expect(connector.start(startArgs())).rejects.toThrow(/external run id path "id"/)
  })
})

describe('generic HTTP connector — refusals', () => {
  it('refuses a private or loopback target before making any request', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials({ startUrl: 'http://127.0.0.1:8080/internal' }),
      fetchImpl,
      lookupHost: publicLookup,
    })

    await expect(connector.start(startArgs())).rejects.toThrow(/private_ip_literal/)
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['a blocked hostname', 'http://localhost:3000/runs', /blocked_hostname/],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data', /private_ip_literal/],
    ['a non-http protocol', 'file:///etc/passwd', /forbidden_protocol/],
    ['credentials embedded in the URL', 'https://user:pass@provider.example.com/v1', /credentials_in_url/],
  ])('refuses %s', async (_label, startUrl, expected) => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials({ startUrl }),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await expect(connector.start(startArgs())).rejects.toThrow(expected)
    expect(requests).toHaveLength(0)
  })

  it('refuses a host whose DNS answer is private — not only a private literal', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: async () => [{ address: '10.0.0.7', family: 4 }],
    })
    await expect(connector.start(startArgs())).rejects.toThrow(/private_ip_resolved/)
    expect(requests).toHaveLength(0)
  })

  it('refuses to follow a redirect', async () => {
    const { fetchImpl } = stubFetch({ status: 302, headers: { location: 'http://169.254.169.254/' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await expect(connector.start(startArgs())).rejects.toThrow(/redirect, which is refused/)
  })

  it('fails closed when the agent declares a connector profile', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })

    await expect(
      connector.start(startArgs({ agentEntry: agentEntry({ profile: 'approvals' }) })),
    ).rejects.toThrow(/cannot serve/)
    expect(requests).toHaveLength(0)
  })

  it('refuses an input the node schema does not describe', async () => {
    const { fetchImpl, requests } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })
    // No `url` field exists, deliberately: where the request goes is tenant
    // configuration and must never be workflow input.
    await expect(
      connector.start(startArgs({ input: { url: 'https://attacker.example.com/' } })),
    ).rejects.toThrow(/cannot send/)
    expect(requests).toHaveLength(0)
  })

  it('refuses a template naming an unknown placeholder', async () => {
    const { fetchImpl } = stubFetch({ body: { id: 'run_9001' } })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials({ requestTemplate: { q: '{{secretKey}}' } }),
      fetchImpl,
      lookupHost: publicLookup,
    })
    await expect(connector.start(startArgs())).rejects.toThrow(/unknown placeholder/)
  })
})

describe('generic HTTP connector — secrets never leave', () => {
  it('redacts the tenant secrets out of a provider error body', async () => {
    // A provider that echoes the request back is common, and this string is
    // persisted on the run and rendered in the cockpit.
    const { fetchImpl } = stubFetch({
      status: 401,
      bodyText: JSON.stringify({
        error: `unknown key ${AUTH_VALUE}`,
        hint: `signed with ${SIGNING_SECRET}`,
      }),
    })
    const connector = createGenericHttpConnector({
      readCredentials: async () => credentials(),
      fetchImpl,
      lookupHost: publicLookup,
    })

    let message = ''
    try {
      await connector.start(startArgs())
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('HTTP 401')
    expect(message).toContain('[redacted]')
    expect(message).not.toContain(AUTH_VALUE)
    expect(message).not.toContain(SIGNING_SECRET)
  })

  it('keeps secrets, the callback URL and the brief out of every log line', async () => {
    const logged: string[] = []
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
      }),
    )
    try {
      const { fetchImpl } = stubFetch({ body: { id: 'run_9001' } })
      const connector = createGenericHttpConnector({
        readCredentials: async () => credentials(),
        fetchImpl,
        lookupHost: publicLookup,
      })
      await connector.start(startArgs())
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }

    const all = logged.join('\n')
    expect(all).not.toContain(AUTH_VALUE)
    expect(all).not.toContain(SIGNING_SECRET)
    expect(all).not.toContain(CALLBACK_TOKEN)
    expect(all).not.toContain('Is the ACME renewal still on?')
  })
})

describe('generic HTTP connector — the seam members it does and does not implement', () => {
  const connector = createGenericHttpConnector({
    readCredentials: async () => credentials(),
    lookupHost: publicLookup,
  })

  it('does NOT implement extractExternalRunId, so the static route cannot settle it', () => {
    // That member is the opt-in to the connector-addressed route, which is weaker
    // (the signature is the only credential). A token-addressed connector needs it
    // not at all.
    expect(connector.extractExternalRunId).toBeUndefined()
  })

  it('does NOT implement cancel, because it could only no-op', () => {
    expect(connector.cancel).toBeUndefined()
  })

  it('implements mock, and the would-do names the request without inventing an answer', () => {
    // The placeholders the runner passes on the simulated path: nothing is minted
    // for a run that never leaves the building.
    const wouldDo = connector.mock?.(
      startArgs({
        callbackUrl: 'simulated://external-run-callback',
        callbackToken: 'simulated-no-callback-token-is-minted',
      }),
    )
    expect(wouldDo).toEqual({
      connectorId: GENERIC_HTTP_CONNECTOR_ID,
      agentId: 'http.remote_researcher',
      wouldPost: {
        to: "this tenant's configured HTTP agent start URL",
        method: 'POST',
        inputKeys: ['brief', 'payload'],
        callbackUrl: 'simulated://external-run-callback',
      },
    })
    // Nothing in it can be read as an outcome — it carries neither half of the
    // researcher envelope — and it carries no bearer.
    const asRecord = wouldDo as Record<string, unknown>
    expect(asRecord.kind).toBeUndefined()
    expect(asRecord.data).toBeUndefined()
    expect(JSON.stringify(wouldDo)).not.toContain('simulated-no-callback-token-is-minted')
  })
})
