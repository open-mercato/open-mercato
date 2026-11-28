import { createServer, type Server } from 'node:http'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'

/**
 * Boundary coverage for issue #5173: proves the HTTP MCP transport's per-tool-call
 * auth decision over a *real* HTTP connection and the *real* MCP wire protocol.
 * Only the DB-backed lookups (`findApiKeyBySecret`, `findSessionApiKeyWithSecret`)
 * and the RBAC role-grant read (`rbacService.loadAcl`) are stubbed — this package
 * has no live-Postgres Jest lane (see `packages/core`'s `test:pg-integration` for
 * the pattern this repo uses elsewhere; ai-assistant isn't wired into it).
 * Everything else — `McpServer`/`StreamableHTTPServerTransport` (real SDK),
 * `extractApiKeyFromHeaders` and `hasRequiredFeatures` (real `../auth`), the tool
 * registry and `executeTool` (real `../tool-registry` / `../tool-executor`),
 * and `tools/list` ACL filtering (real `../mcp-exposure`) — runs for real. The
 * transport key's own `loadAcl` fixture resolves superadmin (the worst case for
 * list-time filtering) specifically so every assertion below proves the
 * per-call `_sessionToken` requirement, not an accident of a narrower list ACL.
 */

jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(async () => {}),
  indexToolsForSearch: jest.fn(async () => {}),
}))

const findApiKeyBySecret = jest.fn()
const findSessionApiKeyWithSecret = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => findApiKeyBySecret(...args),
  findSessionApiKeyWithSecret: (...args: unknown[]) => findSessionApiKeyWithSecret(...args),
}))
jest.mock('@open-mercato/core/modules/auth/lib/tenantEligibility', () => ({
  isStaffTenantActive: jest.fn(async () => true),
}))

import { runMcpHttpServer } from '../http-server'
import { registerMcpTool, unregisterMcpTool } from '../tool-registry'

const TRANSPORT_KEY_SECRET = 'omk_test_transport_secret'
const originalDelegationKey = process.env.MCP_SERVER_API_KEY
const RESTRICTED_SESSION_TOKEN = 'sess_restricted_valid_token'
const TRANSPORT_KEY_RECORD = {
  id: 'infra-key-1',
  keyPrefix: 'omk_test',
  tenantId: null,
  organizationId: null,
  createdBy: 'superadmin-user-1',
}
const RESTRICTED_SESSION_RECORD = {
  key: {
    id: 'session-restricted-1',
    sessionUserId: 'restricted-employee-1',
    createdBy: 'restricted-employee-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  },
  secret: 'sess_secret_for_restricted_employee',
}

const loadAcl = jest.fn(async (userId: string) => {
  if (userId === 'api_key:session-restricted-1') {
    return { isSuperAdmin: false, features: ['allowed.feature'], organizations: null }
  }
  if (userId === 'api_key:infra-key-1') {
    // Worst case: the transport key's own ACL resolves superadmin (e.g. it was
    // created by a superadmin user). This is consulted for `tools/list`
    // filtering only — the test still proves that holding this key alone can
    // never execute a tool without a valid per-user `_sessionToken`.
    return { isSuperAdmin: true, features: ['*'], organizations: null }
  }
  throw new Error(`unexpected loadAcl call for ${userId}`)
})

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not determine a free port'))
      })
    })
    probe.on('error', reject)
  })
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 5000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`MCP HTTP server never became healthy on port ${port}: ${String(lastError)}`)
}

const SCOPED_RECORDS: Record<string, { tenantId: string; organizationId: string }> = {
  'record-in-scope': { tenantId: 'tenant-1', organizationId: 'org-1' },
  'record-out-of-scope': { tenantId: 'tenant-2', organizationId: 'org-2' },
}

type ObservedToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  apiKeySecret: string | undefined
}

let allowedToolRuns = 0
let restrictedToolRuns = 0
let lastAllowedToolContext: ObservedToolContext | null = null
let port: number
let httpServerStartupError: unknown
const serverShutdown = new AbortController()
let serverClosed: Promise<void>

async function callTool(opts: { apiKey?: string; args: Record<string, unknown> }, toolName: string) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: opts.apiKey ? { headers: { 'x-api-key': opts.apiKey } } : undefined,
  })

  try {
    await client.connect(transport)
    return await client.callTool({ name: toolName, arguments: opts.args })
  } finally {
    // The server is already torn down in `afterAll` via `serverShutdown`; a
    // close() rejection here just means the connection was already gone
    // (e.g. the server rejected it before the handshake completed), which
    // every call site in this suite already exercises intentionally — surface
    // it on stderr instead of masking it, but never fail the test on it.
    await client.close().catch((error) => {
      console.warn('MCP test client close() failed (non-fatal):', error)
    })
  }
}

describe('issue #5173 — MCP HTTP transport auth boundary over real HTTP + real MCP protocol', () => {
  beforeAll(async () => {
    process.env.MCP_SERVER_API_KEY = TRANSPORT_KEY_SECRET
    registerMcpTool(
      {
        name: 'allowed_tool',
        description: 'A tool the restricted employee session is authorized to call',
        inputSchema: z.object({ recordId: z.string().optional() }),
        requiredFeatures: ['allowed.feature'],
        handler: async (args, ctx) => {
          allowedToolRuns += 1
          // Capture exactly what the session layer actually propagated into the
          // handler's execution context, so tests can prove it is the *session*
          // user/tenant/organization/secret — not the transport API key's.
          lastAllowedToolContext = {
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            apiKeySecret: ctx.apiKeySecret,
          }

          if (!args.recordId) return { ranAs: 'allowed' }

          // Simulate a real record consumer: the tool's `requiredFeatures` ACL
          // check only proves the caller holds `allowed.feature` — it says
          // nothing about which organization/tenant the requested record
          // belongs to. A real handler must still scope the record lookup to
          // the caller's own tenant/organization.
          const record = SCOPED_RECORDS[args.recordId]
          if (!record) throw new Error(`Unknown record: ${args.recordId}`)
          if (record.tenantId !== ctx.tenantId || record.organizationId !== ctx.organizationId) {
            throw new Error('CROSS_ORG_DENIED')
          }
          return { ranAs: 'allowed', recordId: args.recordId, scopedTo: record }
        },
      },
      { moduleId: 'test-fixture' }
    )
    registerMcpTool(
      {
        name: 'restricted_tool',
        description: 'A tool the restricted employee session is NOT authorized to call',
        inputSchema: z.object({}),
        requiredFeatures: ['restricted.feature'],
        handler: async () => {
          restrictedToolRuns += 1
          return { ranAs: 'restricted' }
        },
      },
      { moduleId: 'test-fixture' }
    )

    findApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
      secret === TRANSPORT_KEY_SECRET ? TRANSPORT_KEY_RECORD : null
    )
    findSessionApiKeyWithSecret.mockImplementation(async (_em: unknown, token: string) =>
      token === RESTRICTED_SESSION_TOKEN ? RESTRICTED_SESSION_RECORD : null
    )

    const container = {
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'rbacService') return { loadAcl }
        throw new Error(`test container has no dependency "${name}"`)
      },
    } as unknown as AwilixContainer

    port = await getFreePort()
    serverClosed = runMcpHttpServer({
      config: { name: 'test-mcp', version: '0.0.0' },
      container,
      port,
      host: '127.0.0.1',
      signal: serverShutdown.signal,
    }).catch((error) => {
      httpServerStartupError = error
    })
    await waitForHealth(port)
  }, 15000)

  beforeEach(() => {
    allowedToolRuns = 0
    restrictedToolRuns = 0
    lastAllowedToolContext = null
    loadAcl.mockClear()
  })

  afterAll(async () => {
    if (originalDelegationKey === undefined) delete process.env.MCP_SERVER_API_KEY
    else process.env.MCP_SERVER_API_KEY = originalDelegationKey
    unregisterMcpTool('allowed_tool')
    unregisterMcpTool('restricted_tool')
    // Own and await this suite's own server teardown instead of relying on
    // `--forceExit` to paper over the leaked listening socket and
    // SIGINT/SIGTERM handlers — and never send a real process signal, which
    // would also reach unrelated fixtures sharing this Jest worker.
    serverShutdown.abort()
    await serverClosed
    expect(httpServerStartupError).toBeUndefined()
  })

  it('rejects a tool call with no x-api-key at the transport level, before any tool runs', async () => {
    await expect(callTool({ args: {} }, 'restricted_tool')).rejects.toThrow()
    expect(restrictedToolRuns).toBe(0)
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('rejects a tool call from the superadmin-owned transport key alone — no header-only fallback exists', async () => {
    const result = await callTool({ apiKey: TRANSPORT_KEY_SECRET, args: {} }, 'restricted_tool')

    expect(result.isError).toBe(true)
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    expect(payload.code).toBe('UNAUTHORIZED')
    expect(restrictedToolRuns).toBe(0)
    // The transport key's ACL is consulted only to decide which tools are listed
    // (even a superadmin-resolved transport key, the worst case, lists every
    // tool) — it is never consulted again to authorize execution. Holding the
    // key alone, with no `_sessionToken`, still fails closed.
    expect(loadAcl).toHaveBeenCalledWith('api_key:infra-key-1', { tenantId: null, organizationId: null })
  })

  it('treats an empty-string _sessionToken as missing, not present', async () => {
    const result = await callTool({ apiKey: TRANSPORT_KEY_SECRET, args: { _sessionToken: '' } }, 'restricted_tool')

    expect(result.isError).toBe(true)
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    expect(payload.code).toBe('UNAUTHORIZED')
    expect(restrictedToolRuns).toBe(0)
  })

  it('rejects an invalid/expired _sessionToken without ever running the tool', async () => {
    const result = await callTool(
      { apiKey: TRANSPORT_KEY_SECRET, args: { _sessionToken: 'sess_does_not_exist' } },
      'allowed_tool'
    )

    expect(result.isError).toBe(true)
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    expect(payload.code).toBe('SESSION_EXPIRED')
    expect(allowedToolRuns).toBe(0)
  })

  it('denies a restricted session a tool outside its granted scope — the tool never executes', async () => {
    const result = await callTool(
      { apiKey: TRANSPORT_KEY_SECRET, args: { _sessionToken: RESTRICTED_SESSION_TOKEN } },
      'restricted_tool'
    )

    expect(result.isError).toBe(true)
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    expect(payload.code).toBe('UNAUTHORIZED')
    expect(restrictedToolRuns).toBe(0)
    expect(loadAcl).toHaveBeenCalledWith('api_key:session-restricted-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('allows a restricted session to call a tool inside its granted scope, under its own identity', async () => {
    const result = await callTool(
      { apiKey: TRANSPORT_KEY_SECRET, args: { _sessionToken: RESTRICTED_SESSION_TOKEN } },
      'allowed_tool'
    )

    expect(result.isError).toBeFalsy()
    expect(allowedToolRuns).toBe(1)
    expect(restrictedToolRuns).toBe(0)
    expect(loadAcl).toHaveBeenCalledWith('api_key:session-restricted-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    // The handler's own execution context must carry the *session's* identity
    // and the *session's* decrypted secret — never the transport key's.
    expect(lastAllowedToolContext).toEqual({
      tenantId: RESTRICTED_SESSION_RECORD.key.tenantId,
      organizationId: RESTRICTED_SESSION_RECORD.key.organizationId,
      userId: RESTRICTED_SESSION_RECORD.key.sessionUserId,
      apiKeySecret: RESTRICTED_SESSION_RECORD.secret,
    })
    // The transport-level credential used to open the HTTP connection must
    // never reach the tool's consuming business logic.
    expect(lastAllowedToolContext!.apiKeySecret).not.toBe(TRANSPORT_KEY_SECRET)
  })

  it('allows a restricted session to read a record within its own organization/tenant scope', async () => {
    const result = await callTool(
      {
        apiKey: TRANSPORT_KEY_SECRET,
        args: { _sessionToken: RESTRICTED_SESSION_TOKEN, recordId: 'record-in-scope' },
      },
      'allowed_tool'
    )

    expect(result.isError).toBeFalsy()
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    expect(payload).toEqual({
      ranAs: 'allowed',
      recordId: 'record-in-scope',
      scopedTo: SCOPED_RECORDS['record-in-scope'],
    })
    expect(allowedToolRuns).toBe(1)
  })

  it('denies a restricted session a record scoped to a different organization/tenant, even though the feature check passes', async () => {
    const result = await callTool(
      {
        apiKey: TRANSPORT_KEY_SECRET,
        args: { _sessionToken: RESTRICTED_SESSION_TOKEN, recordId: 'record-out-of-scope' },
      },
      'allowed_tool'
    )

    expect(result.isError).toBe(true)
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    // The ACL/feature gate passed — this is an EXECUTION_ERROR from the handler's
    // own tenant/organization scoping, not an UNAUTHORIZED from `requiredFeatures`.
    expect(payload.code).toBe('EXECUTION_ERROR')
    expect(payload.error).toContain('CROSS_ORG_DENIED')
    // The handler did run (proving the feature check matched) — it just refused
    // to return the out-of-scope record.
    expect(allowedToolRuns).toBe(1)
    expect(lastAllowedToolContext).toEqual({
      tenantId: RESTRICTED_SESSION_RECORD.key.tenantId,
      organizationId: RESTRICTED_SESSION_RECORD.key.organizationId,
      userId: RESTRICTED_SESSION_RECORD.key.sessionUserId,
      apiKeySecret: RESTRICTED_SESSION_RECORD.secret,
    })
  })
})
