import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { EventSubscriber } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AdvisoryLockUnavailableError, withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { isTransientLockDbError } from '@open-mercato/shared/lib/db/pg-errors'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { IntegrationCredentials, IntegrationLog } from '../../../data/entities'
import { createTestKms, startPgTestOrm, type PgTestOrm, type TestKms } from '../../../__tests__/support/pgTestOrm'
import {
  createCredentialsService,
  eraseIntegrationCredentials,
  readCredentialRowLayered,
} from '../../credentials-service'
import { exchangeAuthorizationCode } from '../authorization'
import {
  OAuthGrantError,
  type OAuthFailureReason,
  type OAuthGrantOwner,
  type OAuthProviderDescriptor,
  type OAuthTokenFailure,
} from '../descriptor'
import {
  oauthGrantLockKey,
  oauthGrantRowId,
  parseOAuthGrantBlob,
  serializeOAuthGrantBlob,
  type OAuthGrantRecord,
} from '../grant-blob'
import {
  createIntegrationOAuthGrantService,
  type IntegrationOAuthGrantService,
  type IntegrationOAuthGrantServiceDeps,
  type OAuthAccessToken,
} from '../grant-service'
import { createPkcePair } from '../pkce'
import { requestTokenEndpoint, revokeToken, type OAuthTokenEndpointResponse } from '../token-endpoint'
import {
  startFakeAuthorizationServer,
  type FakeAuthorizationServer,
  type FakeAuthorizationServerOptions,
  type FakeInjection,
} from '../testing/fakeAuthorizationServer'

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/shared/lib/db/advisoryLock')>(
    '@open-mercato/shared/lib/db/advisoryLock',
  )
  return { ...actual, withAdvisoryXactLock: jest.fn(actual.withAdvisoryXactLock) }
})

jest.mock('@open-mercato/shared/lib/db/pg-errors', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/shared/lib/db/pg-errors')>('@open-mercato/shared/lib/db/pg-errors')
  return { ...actual, isTransientLockDbError: jest.fn(actual.isTransientLockDbError) }
})

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 20_000
const INTEGRATION_ID = 'test_oauth_grant'
const SECOND_INTEGRATION_ID = 'test_oauth_grant_second'
const CREDENTIALS_ENTITY_ID = 'integrations:integration_credentials'
const ENVELOPE_KEY = '__om_encrypted_credentials_blob_v1'
const DEFAULT_SCOPES = ['test.read', 'test.write']
const REDIRECT_URI = 'http://127.0.0.1/callback'
const INVALIDATED = 'integrations.oauth_invalidated'
const REFRESH_TRANSIENT = 'integrations.oauth_refresh_transient'
const CLIENT_MISCONFIGURED = 'integrations.oauth_client_misconfigured'
const PLATFORM_UNAVAILABLE = 'integrations.oauth_platform_unavailable'
const SLOT_REGISTRY_KEY = '__openMercatoAdvisoryLockSlots__'
const GRANT_LOCK_NAMESPACE = 'oauth_grant'
const BACKDATE_MS = 10 * 60 * 1000
const HOUR_MS = 3600 * 1000
const YEAR_MS = 31_536_000 * 1000

const actualLock = jest.requireActual<typeof import('@open-mercato/shared/lib/db/advisoryLock')>(
  '@open-mercato/shared/lib/db/advisoryLock',
)
const mockWithAdvisoryXactLock = withAdvisoryXactLock as jest.MockedFunction<typeof withAdvisoryXactLock>
const mockIsTransientLockDbError = isTransientLockDbError as jest.MockedFunction<typeof isTransientLockDbError>

type TokenClient = NonNullable<IntegrationOAuthGrantServiceDeps['tokenClient']>
type RefreshInjection = Omit<FakeInjection, 'endpoint' | 'grantType'>
type RawGrantRow = { id: string; credentials: string; updated_at: string; deleted_at: string | null }
type LogRow = { code: string; level: string; payload: Record<string, unknown> | null }
type MapRow = { id: string; is_active: boolean; updated_at: string }
type Gate = { promise: Promise<void>; open(): void }
type GatedTokenClient = {
  client: TokenClient
  entered: Promise<void>
  stats: { calls: number; inFlight: number; maxInFlight: number }
}
type StallingKms = KmsService & { stallNextLookup(): void; stalled: Promise<void>; release(): void }
type CountingKms = KmsService & { calls: { getTenantDek: number; createTenantDek: number } }
type SlotNamespace = { held: number; waiters: unknown[] }
type HeldConnections = { release(): Promise<void> }
type ConnectInput = {
  authorizationServer?: FakeAuthorizationServer
  scope?: string[]
  requestedScopes?: string[]
  omitRefreshToken?: boolean
  descriptor?: Partial<OAuthProviderDescriptor>
}
type TokenInput = {
  options?: { minValidityMs?: number; rejectedAccessToken?: string; forceRefresh?: boolean }
  deps?: Partial<IntegrationOAuthGrantServiceDeps>
  authorizationServer?: FakeAuthorizationServer
  descriptor?: Partial<OAuthProviderDescriptor>
}

function createOwner(integrationId: string = INTEGRATION_ID): OAuthGrantOwner {
  return { integrationId, tenantId: randomUUID(), organizationId: randomUUID() }
}

function scopeOf(owner: OAuthGrantOwner) {
  return { tenantId: owner.tenantId, organizationId: owner.organizationId }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function createGate(): Gate {
  let openGate: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    openGate = resolve
  })
  return { promise, open: () => openGate() }
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`[internal] timed out waiting for ${label}`)
    await sleep(20)
  }
}

function outcomeOf<T>(promise: Promise<T>): Promise<T | unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  )
}

function simulatedLockTimeout(): Error {
  return Object.assign(new Error('[internal] simulated lock timeout'), { code: '55P03' })
}

function hexToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('hex')}`
}

function errorChainMatches(error: unknown, pattern: RegExp): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (pattern.test(current.message)) return true
    const linked = current as Error & { previous?: unknown }
    current = linked.cause ?? linked.previous
  }
  return false
}

function grantLockSlots(): { held: number; waiting: number } {
  const registry = (globalThis as Record<string, unknown>)[SLOT_REGISTRY_KEY]
  const slots = registry instanceof Map ? (registry.get(GRANT_LOCK_NAMESPACE) as SlotNamespace | undefined) : undefined
  return { held: slots?.held ?? 0, waiting: slots?.waiters.length ?? 0 }
}

function createGatedTokenClient(gate: Gate): GatedTokenClient {
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0 }
  const firstEntry = createGate()
  return {
    stats,
    entered: firstEntry.promise,
    client: {
      async requestTokenEndpoint(input) {
        stats.calls += 1
        stats.inFlight += 1
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
        firstEntry.open()
        try {
          await gate.promise
          return await requestTokenEndpoint(input)
        } finally {
          stats.inFlight -= 1
        }
      },
      revokeToken,
    },
  }
}

function createStallingKms(target: KmsService): StallingKms {
  const stalledGate = createGate()
  const releaseGate = createGate()
  let armed = false
  return {
    isHealthy: () => target.isHealthy(),
    async getTenantDek(tenantId) {
      if (armed) {
        armed = false
        stalledGate.open()
        await releaseGate.promise
      }
      return target.getTenantDek(tenantId)
    },
    createTenantDek: (tenantId) => target.createTenantDek(tenantId),
    stallNextLookup() {
      armed = true
    },
    stalled: stalledGate.promise,
    release: () => releaseGate.open(),
  }
}

function countingKms(target: KmsService): CountingKms {
  const calls = { getTenantDek: 0, createTenantDek: 0 }
  return {
    calls,
    isHealthy: () => target.isHealthy(),
    getTenantDek: (tenantId) => {
      calls.getTenantDek += 1
      return target.getTenantDek(tenantId)
    },
    createTenantDek: (tenantId) => {
      calls.createTenantDek += 1
      return target.createTenantDek(tenantId)
    },
  }
}

async function closedLoopbackTokenEndpoint(): Promise<string> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const address = probe.address()
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new Error('[internal] the probe server bound no TCP port')
  return `http://127.0.0.1:${address.port}/token`
}

async function occupyConnections(em: EntityManager, count: number): Promise<HeldConnections> {
  const gate = createGate()
  const entries = Array.from({ length: count }, () => createGate())
  const holders = entries.map((entry) => em.fork().transactional(async (tx) => {
    await tx.execute('select 1')
    entry.open()
    await gate.promise
  }))
  const endedEarly = Promise.all(holders).then(() => {
    throw new Error('[internal] a connection holder ended before it was released')
  })
  await Promise.race([Promise.all(entries.map((entry) => entry.promise)), endedEarly])
  return {
    async release() {
      gate.open()
      await Promise.all(holders)
    },
  }
}

async function expectGrantError(promise: Promise<unknown>, code: OAuthTokenFailure): Promise<OAuthGrantError> {
  const error = await outcomeOf(promise)
  expect(error).toBeInstanceOf(OAuthGrantError)
  expect((error as OAuthGrantError).code).toBe(code)
  return error as OAuthGrantError
}

describeWithPostgres('integrationOAuthGrantService.getAccessToken against real PostgreSQL', () => {
  let pg: PgTestOrm | null = null
  let fake: FakeAuthorizationServer | null = null
  let activeKms: TestKms = createTestKms()
  let unregisterTelemetry: (() => void) | null = null
  const reportError = jest.fn<void, Parameters<TelemetryRuntime['reportError']>>()
  const failing: { logCode: string | null; grantUpdates: boolean } = { logCode: null, grantUpdates: false }

  function harness(): PgTestOrm {
    if (!pg) throw new Error('[internal] pgTestOrm is not started')
    return pg
  }

  function server(): FakeAuthorizationServer {
    if (!fake) throw new Error('[internal] fake authorization server is not started')
    return fake
  }

  function fork(): EntityManager {
    return harness().em.fork()
  }

  function descriptorOf(
    owner: OAuthGrantOwner,
    authorizationServer: FakeAuthorizationServer = server(),
    overrides: Partial<OAuthProviderDescriptor> = {},
  ): OAuthProviderDescriptor {
    return {
      integrationId: owner.integrationId,
      authorizationEndpoint: authorizationServer.authorizationEndpoint,
      tokenEndpoint: authorizationServer.tokenEndpoint,
      ...(authorizationServer.revocationEndpoint ? { revocationEndpoint: authorizationServer.revocationEndpoint } : {}),
      defaultScopes: DEFAULT_SCOPES,
      ...overrides,
    }
  }

  function createService(deps: Partial<IntegrationOAuthGrantServiceDeps> = {}): IntegrationOAuthGrantService {
    return createIntegrationOAuthGrantService({ em: fork(), ...deps })
  }

  function getToken(owner: OAuthGrantOwner, input: TokenInput = {}): Promise<OAuthAccessToken> {
    const descriptor = descriptorOf(owner, input.authorizationServer, input.descriptor)
    return createService(input.deps).getAccessToken(descriptor, owner, input.options)
  }

  async function configureClient(
    owner: OAuthGrantOwner,
    authorizationServer: FakeAuthorizationServer = server(),
    overrides: { clientId?: string; clientSecret?: string } = {},
  ): Promise<void> {
    await createCredentialsService(fork()).save(
      owner.integrationId,
      {
        clientId: overrides.clientId ?? authorizationServer.clientId,
        clientSecret: overrides.clientSecret ?? authorizationServer.clientSecret,
      },
      scopeOf(owner),
    )
  }

  async function obtainTokens(
    owner: OAuthGrantOwner,
    authorizationServer: FakeAuthorizationServer = server(),
    input: { scope?: string[]; omitRefreshToken?: boolean } = {},
  ): Promise<OAuthTokenEndpointResponse> {
    if (input.omitRefreshToken) {
      authorizationServer.inject({ endpoint: 'token', grantType: 'authorization_code', omitRefreshToken: true })
    }
    const pkce = createPkcePair()
    const code = authorizationServer.issueAuthorizationCode({
      redirectUri: REDIRECT_URI,
      scope: input.scope,
      codeChallenge: pkce.codeChallenge,
    })
    return exchangeAuthorizationCode(
      descriptorOf(owner, authorizationServer),
      { clientId: authorizationServer.clientId, clientSecret: authorizationServer.clientSecret },
      { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier },
    )
  }

  async function readStoredGrant(owner: OAuthGrantOwner, kms: KmsService = activeKms): Promise<OAuthGrantRecord> {
    const read = await readCredentialRowLayered(fork(), oauthGrantRowId(owner.integrationId), scopeOf(owner), {
      kms,
      validate: parseOAuthGrantBlob,
    })
    if (read.kind !== 'ok') throw new Error(`[internal] expected a readable grant, got ${read.kind}`)
    return read.value
  }

  async function writeStoredGrant(owner: OAuthGrantOwner, grant: OAuthGrantRecord): Promise<OAuthGrantRecord> {
    await createCredentialsService(fork(), null, { kms: activeKms })
      .save(oauthGrantRowId(owner.integrationId), serializeOAuthGrantBlob(grant), scopeOf(owner))
    return readStoredGrant(owner)
  }

  async function backdateStoredGrant(owner: OAuthGrantOwner): Promise<OAuthGrantRecord> {
    const grant = await readStoredGrant(owner)
    const backdate = (value: Date | null) => (value === null ? null : new Date(value.getTime() - BACKDATE_MS))
    return writeStoredGrant(owner, {
      ...grant,
      obtainedAt: new Date(grant.obtainedAt.getTime() - BACKDATE_MS),
      refreshedAt: backdate(grant.refreshedAt),
      lastFailureAt: backdate(grant.lastFailureAt),
    })
  }

  async function expireStoredGrant(owner: OAuthGrantOwner): Promise<OAuthGrantRecord> {
    return writeStoredGrant(owner, { ...(await readStoredGrant(owner)), expiresAt: new Date(Date.now() - 60_000) })
  }

  async function connectOwner(owner: OAuthGrantOwner, input: ConnectInput = {}): Promise<OAuthGrantRecord> {
    const authorizationServer = input.authorizationServer ?? server()
    await configureClient(owner, authorizationServer)
    const tokens = await obtainTokens(owner, authorizationServer, input)
    await createService().completeConnect(descriptorOf(owner, authorizationServer, input.descriptor), owner, tokens, {
      clientId: authorizationServer.clientId,
      requestedScopes: input.requestedScopes,
    })
    return backdateStoredGrant(owner)
  }

  async function readRawGrantRows(owner: OAuthGrantOwner): Promise<RawGrantRow[]> {
    return fork().execute<RawGrantRow[]>(
      `select "id", "credentials"::text as "credentials", "updated_at"::text as "updated_at", "deleted_at"
       from "integration_credentials"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by "created_at" asc`,
      [oauthGrantRowId(owner.integrationId), owner.tenantId, owner.organizationId],
    )
  }

  async function readLogs(owner: OAuthGrantOwner, code: string): Promise<LogRow[]> {
    return fork().execute<LogRow[]>(
      `select "code", "level", "payload" from "integration_logs"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ? and "code" = ?
       order by "created_at" asc`,
      [owner.integrationId, owner.tenantId, owner.organizationId, code],
    )
  }

  async function readScopeMapRows(owner: OAuthGrantOwner): Promise<MapRow[]> {
    return fork().execute<MapRow[]>(
      `select "id", "is_active", "updated_at"::text as "updated_at" from "encryption_maps"
       where "entity_id" = ? and "tenant_id" = ? and "organization_id" = ? and "deleted_at" is null`,
      [CREDENTIALS_ENTITY_ID, owner.tenantId, owner.organizationId],
    )
  }

  async function isGrantLockFree(owner: OAuthGrantOwner): Promise<boolean> {
    return fork().transactional(async (tx) => {
      const rows = await tx.execute<Array<{ locked: boolean }>>(
        'select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as locked',
        [oauthGrantLockKey(owner)],
      )
      return rows[0]?.locked === true
    })
  }

  async function holdGrantLock(owner: OAuthGrantOwner): Promise<HeldConnections> {
    const gate = createGate()
    const held = createGate()
    const holding = fork().transactional(async (tx) => {
      await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [oauthGrantLockKey(owner)])
      held.open()
      await gate.promise
    })
    await Promise.race([held.promise, holding])
    return {
      async release() {
        gate.open()
        await holding
      },
    }
  }

  async function backendPid(em: EntityManager): Promise<number> {
    const rows = await em.execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
    return rows[0]?.pid ?? -1
  }

  function injectRefresh(injection: RefreshInjection, authorizationServer: FakeAuthorizationServer = server()): void {
    authorizationServer.inject({ ...injection, endpoint: 'token', grantType: 'refresh_token' })
  }

  function refreshCalls(authorizationServer: FakeAuthorizationServer = server()): number {
    return authorizationServer.counters().token.refreshToken
  }

  function reportedCodes(): string[] {
    return reportError.mock.calls.map(([, context]) => context?.code ?? '')
  }

  function expectNoIssuedToken(value: unknown, extraTokens: string[] = []): void {
    const serialized = JSON.stringify(value, (_key, entry: unknown) => (
      entry instanceof Error ? { name: entry.name, message: entry.message, cause: entry.cause } : entry
    ))
    const issued = server().issuedTokens()
    for (const token of [...issued.accessTokens, ...issued.refreshTokens, ...extraTokens]) {
      expect(serialized).not.toContain(token)
    }
  }

  beforeAll(async () => {
    pg = await startPgTestOrm()
    fake = await startFakeAuthorizationServer({ rotation: 'strict' })
    const failingLogSubscriber: EventSubscriber<IntegrationLog> = {
      getSubscribedEntities: () => [IntegrationLog],
      beforeCreate: (args) => {
        if (failing.logCode !== null && args.entity.code === failing.logCode) {
          throw new Error('[internal] simulated integration log failure')
        }
      },
    }
    const failingGrantSubscriber: EventSubscriber<IntegrationCredentials> = {
      getSubscribedEntities: () => [IntegrationCredentials],
      beforeUpdate: (args) => {
        if (failing.grantUpdates && args.entity.integrationId.endsWith('__oauth_grant')) throw simulatedLockTimeout()
      },
    }
    pg.em.getEventManager().registerSubscriber(failingLogSubscriber)
    pg.em.getEventManager().registerSubscriber(failingGrantSubscriber)
    const telemetry: TelemetryRuntime = {
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({}),
      continueTrace: (_carrier, _name, fn) => fn(),
      recordHttpDuration: () => undefined,
      reportError,
      shutdown: async () => undefined,
    }
    unregisterTelemetry = registerTelemetryRuntime(telemetry)
  }, 120_000)

  afterEach(() => {
    expect(server().takePendingInjections()).toEqual([])
  })

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    failing.logCode = null
    failing.grantUpdates = false
    reportError.mockClear()
    mockWithAdvisoryXactLock.mockReset()
    mockWithAdvisoryXactLock.mockImplementation(actualLock.withAdvisoryXactLock)
    mockIsTransientLockDbError.mockClear()
    server().reset()
    activeKms = createTestKms()
    harness().setKms(activeKms)
  })

  afterAll(async () => {
    unregisterTelemetry?.()
    await fake?.close()
    await pg?.close()
  }, 30_000)

  it('returns a fresh stored token on the fast path, without the Grant Lock or a token call', async () => {
    const owner = createOwner()
    const stored = await connectOwner(owner)
    mockWithAdvisoryXactLock.mockClear()

    const token = await getToken(owner)

    expect(token).toEqual({
      accessToken: stored.accessToken,
      expiresAt: stored.expiresAt,
      degraded: false,
      grantedScopes: DEFAULT_SCOPES,
      providerData: null,
    })
    expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
    expect(refreshCalls()).toBe(0)
  }, CASE_TIMEOUT_MS)

  it('refreshes an expired token with one token call under the lock, never moving revisedAt, stored like an admin-path row (A19, A22)', async () => {
    const owner = createOwner()
    const connected = await connectOwner(owner)
    await expireStoredGrant(owner)
    const mapsBefore = await readScopeMapRows(owner)
    const invalidateMap = jest.fn(async () => undefined)
    const lockFreeDuringCall: boolean[] = []
    const tokenClient: TokenClient = {
      async requestTokenEndpoint(input) {
        lockFreeDuringCall.push(await isGrantLockFree(owner))
        return requestTokenEndpoint(input)
      },
      revokeToken,
    }

    const token = await getToken(owner, { deps: { tokenClient, encryptionService: { invalidateMap } } })

    const issued = server().issuedTokens()
    expect(issued.accessTokens).toHaveLength(2)
    const stored = await readStoredGrant(owner)
    expect(token).toEqual({
      accessToken: issued.accessTokens[1],
      expiresAt: stored.expiresAt,
      degraded: false,
      grantedScopes: DEFAULT_SCOPES,
      providerData: null,
    })
    expect(lockFreeDuringCall).toEqual([false])
    expect(refreshCalls()).toBe(1)
    expect(stored).toMatchObject({
      status: 'active',
      accessToken: issued.accessTokens[1],
      refreshToken: issued.refreshTokens[1],
      refreshCount: 1,
      lastFailureClass: null,
      lastFailureAt: null,
    })
    expect(stored.revisedAt).toEqual(connected.revisedAt)
    expect(stored.obtainedAt).toEqual(connected.obtainedAt)
    expect(stored.expiresAt.getTime() - (stored.refreshedAt?.getTime() ?? 0)).toBe(HOUR_MS)
    const [refreshRequest] = server().requests().filter((request) => request.params.grant_type === 'refresh_token')
    expect(refreshRequest?.params).toEqual({ grant_type: 'refresh_token', refresh_token: connected.refreshToken })
    const rows = await readRawGrantRows(owner)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.credentials).not.toContain(ENVELOPE_KEY)
    expectNoIssuedToken(rows)
    expect(await readScopeMapRows(owner)).toEqual(mapsBefore)
    expect(invalidateMap).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  }, CASE_TIMEOUT_MS)

  describe('cross-process refresh (A16, A17)', () => {
    it('makes exactly one refresh for 20 concurrent callers over several DB sessions, with one token for all (A16)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const gate = createGate()
      const gated = createGatedTokenClient(gate)
      const pids = new Set<number>()
      let waits = 0
      mockWithAdvisoryXactLock.mockImplementation((em, key, fn, options) => actualLock.withAdvisoryXactLock(
        em,
        key,
        async (txEm) => {
          pids.add(await backendPid(txEm))
          return fn(txEm)
        },
        {
          ...options,
          onWait: async () => {
            waits += 1
            pids.add(await backendPid(em.fork()))
            return options?.onWait ? options.onWait() : { done: false }
          },
        },
      ))

      mockWithAdvisoryXactLock.mockClear()

      const callers = Array.from({ length: 20 }, () => getToken(owner, { deps: { tokenClient: gated.client } }))
      try {
        await waitFor(() => mockWithAdvisoryXactLock.mock.calls.length === 20 && waits > 0, 'twenty callers behind the Grant Lock')
      } finally {
        gate.open()
      }
      const tokens = await Promise.all(callers)

      const stored = await readStoredGrant(owner)
      expect(new Set(tokens.map((token) => token.accessToken))).toEqual(new Set([stored.accessToken]))
      expect(tokens.every((token) => !token.degraded)).toBe(true)
      expect(gated.stats.calls).toBe(1)
      expect(refreshCalls()).toBe(1)
      expect(stored).toMatchObject({ status: 'active', refreshCount: 1 })
      expect(await readLogs(owner, INVALIDATED)).toEqual([])
      expect(pids.size).toBeGreaterThanOrEqual(2)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('leaves the later writer tokens when a Reconnect waits behind a delayed refresh (A17)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const gate = createGate()
      const gated = createGatedTokenClient(gate)
      mockWithAdvisoryXactLock.mockClear()

      const refreshing = getToken(owner, { deps: { tokenClient: gated.client } })
      const reconnectTokens = await obtainTokens(owner)
      let reconnecting: ReturnType<IntegrationOAuthGrantService['completeConnect']> | null = null
      try {
        await gated.entered
        reconnecting = createService().completeConnect(descriptorOf(owner), owner, reconnectTokens, {
          clientId: server().clientId,
        })
        await waitFor(() => mockWithAdvisoryXactLock.mock.calls.length === 2, 'the Reconnect to wait for the Grant Lock')
      } finally {
        gate.open()
      }
      const [refreshed, reconnected] = await Promise.all([refreshing, reconnecting])

      const stored = await readStoredGrant(owner)
      expect(stored).toMatchObject({
        status: 'active',
        accessToken: reconnectTokens.accessToken,
        refreshToken: reconnectTokens.refreshToken,
        refreshedAt: null,
        refreshCount: 0,
      })
      expect(stored.revisedAt).toEqual(reconnected.revisedAt)
      expect(refreshed.accessToken).not.toBe(reconnectTokens.accessToken)
      expect(server().issuedTokens().accessTokens).toContain(refreshed.accessToken)
      expect(refreshCalls()).toBe(1)
    }, CASE_TIMEOUT_MS)

    it('returns the Reconnect token when the Reconnect commits before a delayed refresh takes the lock (A17)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const reachedLock = createGate()
      const lockEntry = createGate()
      mockWithAdvisoryXactLock.mockImplementationOnce(async (em, key, fn, options) => {
        reachedLock.open()
        await lockEntry.promise
        return actualLock.withAdvisoryXactLock(em, key, fn, options)
      })

      const refreshing = getToken(owner)
      await reachedLock.promise
      const reconnectTokens = await obtainTokens(owner)
      await createService().completeConnect(descriptorOf(owner), owner, reconnectTokens, { clientId: server().clientId })
      lockEntry.open()
      const token = await refreshing

      expect(token).toMatchObject({ accessToken: reconnectTokens.accessToken, degraded: false })
      expect(refreshCalls()).toBe(0)
      expect(await readStoredGrant(owner)).toMatchObject({
        accessToken: reconnectTokens.accessToken,
        refreshToken: reconnectTokens.refreshToken,
      })
    }, CASE_TIMEOUT_MS)
  })

  describe('Token Provider classification (A18)', () => {
    const transientResponses: Array<[string, RefreshInjection]> = [
      ['a 503 without an OAuth error', { status: 503, body: {} }],
      ['a 503 carrying invalid_grant', { status: 503, body: { error: 'invalid_grant' } }],
      ['a 429 carrying invalid_grant', { status: 429, body: { error: 'invalid_grant' } }],
      ['a 500 server_error', { status: 500, body: { error: 'server_error' } }],
      ['a 400 temporarily_unavailable', { status: 400, body: { error: 'temporarily_unavailable' } }],
      ['a 400 server_error', { status: 400, body: { error: 'server_error' } }],
      ['a 200 that is not JSON', { status: 200, rawBody: 'not json' }],
    ]

    async function expectTransientDiagnostic(owner: OAuthGrantOwner, before: OAuthGrantRecord, startedAt: number) {
      const stored = await readStoredGrant(owner)
      expect(stored).toEqual({ ...before, lastFailureClass: 'transient', lastFailureAt: expect.any(Date) })
      expect(stored.lastFailureAt?.getTime() ?? 0).toBeGreaterThanOrEqual(startedAt)
    }

    it.each(transientResponses)('classifies %s as transient, keeping the status and the tokens', async (_label, injection) => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      injectRefresh(injection)
      const startedAt = Date.now()

      await expectGrantError(getToken(owner), 'transient')

      await expectTransientDiagnostic(owner, expired, startedAt)
      expect(refreshCalls()).toBe(1)
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT])
      expectNoIssuedToken(reportError.mock.calls)
    }, CASE_TIMEOUT_MS)

    it('classifies a refused connection as transient', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      const startedAt = Date.now()

      await expectGrantError(getToken(owner, { descriptor: { tokenEndpoint: await closedLoopbackTokenEndpoint() } }), 'transient')

      await expectTransientDiagnostic(owner, expired, startedAt)
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('classifies a token call timeout as transient', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      injectRefresh({ delayMs: 2_000 })
      const tokenClient: TokenClient = {
        requestTokenEndpoint: (input) => requestTokenEndpoint({ ...input, timeoutMs: 200 }),
        revokeToken,
      }
      const startedAt = Date.now()

      await expectGrantError(getToken(owner, { deps: { tokenClient } }), 'transient')

      await expectTransientDiagnostic(owner, expired, startedAt)
      expect(refreshCalls()).toBe(1)
    }, CASE_TIMEOUT_MS)

    it('returns a still valid stored token degraded on a transient failure, but never for a rejectedAccessToken call', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner)
      injectRefresh({ status: 503, body: {} })

      const token = await getToken(owner, { options: { forceRefresh: true } })

      expect(token).toEqual({
        accessToken: connected.accessToken,
        expiresAt: connected.expiresAt,
        degraded: true,
        grantedScopes: DEFAULT_SCOPES,
        providerData: null,
      })
      await backdateStoredGrant(owner)
      injectRefresh({ status: 503, body: {} })
      await expectGrantError(getToken(owner, { options: { rejectedAccessToken: connected.accessToken } }), 'transient')
      expect(refreshCalls()).toBe(2)
      expect((await readStoredGrant(owner)).accessToken).toBe(connected.accessToken)
    }, CASE_TIMEOUT_MS)

    const clientResponses: Array<[string, RefreshInjection, OAuthFailureReason | null, string | null]> = [
      ['invalid_client', { status: 401, body: { error: 'invalid_client' } }, null, null],
      ['unauthorized_client', { status: 400, body: { error: 'unauthorized_client' } }, null, null],
      ['invalid_request', { status: 400, body: { error: 'invalid_request' } }, 'token_endpoint_rejected', 'invalid_request'],
      ['unsupported_grant_type', { status: 400, body: { error: 'unsupported_grant_type' } }, 'token_endpoint_rejected', 'unsupported_grant_type'],
      ['invalid_scope', { status: 400, body: { error: 'invalid_scope' } }, 'token_endpoint_rejected', 'invalid_scope'],
      ['an unknown code', { status: 400, body: { error: 'vendor_refusal' } }, 'token_endpoint_rejected', 'vendor_refusal'],
    ]

    it.each(clientResponses)('classifies %s as client_misconfigured and leaves the grant active', async (_label, injection, reason, providerErrorCode) => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      injectRefresh(injection)

      const error = await expectGrantError(getToken(owner), 'client_misconfigured')

      expect(error.reason).toBe(reason)
      expect(error.providerErrorCode).toBe(providerErrorCode)
      expect(await readStoredGrant(owner)).toEqual({
        ...expired,
        lastFailureClass: 'client_misconfigured',
        lastFailureAt: expect.any(Date),
        lastFailureProviderErrorCode: providerErrorCode,
      })
      expect(refreshCalls()).toBe(1)
      expect(reportedCodes()).toEqual([CLIENT_MISCONFIGURED])
    }, CASE_TIMEOUT_MS)

    it('gives a caller that waited behind a client_misconfigured refresh the recorded reason and provider error code', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      injectRefresh({ status: 400, body: { error: 'invalid_scope' } })
      const gate = createGate()
      const gated = createGatedTokenClient(gate)
      mockWithAdvisoryXactLock.mockClear()

      const leader = outcomeOf(getToken(owner, { deps: { tokenClient: gated.client } }))
      await gated.entered
      const follower = outcomeOf(getToken(owner, { deps: { tokenClient: gated.client } }))
      try {
        await waitFor(() => mockWithAdvisoryXactLock.mock.calls.length === 2, 'the follower behind the Grant Lock')
      } finally {
        gate.open()
      }

      for (const error of [await leader, await follower]) {
        expect(error).toBeInstanceOf(OAuthGrantError)
        expect(error).toMatchObject({ code: 'client_misconfigured', reason: 'token_endpoint_rejected', providerErrorCode: 'invalid_scope' })
      }
      expect(gated.stats.calls).toBe(1)
      expect(reportedCodes()).toEqual([CLIENT_MISCONFIGURED])
    }, CASE_TIMEOUT_MS)

    it('answers client_changed and client_not_configured from the read, with no lock and no token call', async () => {
      const changed = createOwner()
      const missing = createOwner()
      const blankSecret = createOwner()
      for (const owner of [changed, missing, blankSecret]) await connectOwner(owner)
      await configureClient(changed, server(), { clientId: 'another-client-id' })
      await eraseIntegrationCredentials(fork(), INTEGRATION_ID, scopeOf(missing))
      await configureClient(blankSecret, server(), { clientSecret: '' })
      mockWithAdvisoryXactLock.mockClear()

      const changedError = await expectGrantError(getToken(changed, { options: { forceRefresh: true } }), 'client_misconfigured')
      const missingError = await expectGrantError(getToken(missing, { options: { forceRefresh: true } }), 'client_misconfigured')
      const blankError = await expectGrantError(getToken(blankSecret, { options: { forceRefresh: true } }), 'client_misconfigured')

      expect([changedError.reason, missingError.reason, blankError.reason]).toEqual([
        'client_changed',
        'client_not_configured',
        'client_not_configured',
      ])
      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(refreshCalls()).toBe(0)
      expect((await readStoredGrant(changed)).lastFailureClass).toBeNull()
    }, CASE_TIMEOUT_MS)

    it('invalidates the grant on invalid_grant with one oauth_invalidated in the same commit, then fails fast (I3)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      injectRefresh({ status: 400, body: { error: 'invalid_grant' } })

      const error = await expectGrantError(getToken(owner), 'grant_invalidated')

      expect(error.reason).toBe('grant_rejected')
      expect(await readStoredGrant(owner)).toEqual({
        ...expired,
        status: 'invalidated',
        invalidatedReason: 'grant_rejected',
        invalidatedAt: expect.any(Date),
      })
      expect(await readLogs(owner, INVALIDATED)).toEqual([
        { code: INVALIDATED, level: 'warn', payload: { reason: 'grant_rejected' } },
      ])
      mockWithAdvisoryXactLock.mockClear()
      const again = await expectGrantError(getToken(owner, { options: { forceRefresh: true } }), 'grant_invalidated')
      expect(again.reason).toBe('grant_rejected')
      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(refreshCalls()).toBe(1)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('invalidates an expired grant without a refresh token as no_refresh_token, with no token call', async () => {
      const owner = createOwner()
      await connectOwner(owner, { omitRefreshToken: true, descriptor: { requiresRefreshToken: false } })
      const expired = await expireStoredGrant(owner)

      const error = await expectGrantError(getToken(owner), 'grant_invalidated')

      expect(error.reason).toBe('no_refresh_token')
      expect(await readStoredGrant(owner)).toEqual({
        ...expired,
        status: 'invalidated',
        invalidatedReason: 'no_refresh_token',
        invalidatedAt: expect.any(Date),
      })
      expect(await readLogs(owner, INVALIDATED)).toEqual([
        { code: INVALIDATED, level: 'warn', payload: { reason: 'no_refresh_token' } },
      ])
      expect(refreshCalls()).toBe(0)
    }, CASE_TIMEOUT_MS)

    it('answers not_connected without a live grant, with no lock', async () => {
      const owner = createOwner()
      await configureClient(owner)

      await expectGrantError(getToken(owner, { options: { forceRefresh: true } }), 'not_connected')

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    type UnreadableCase = {
      label: string
      prepare: (owner: OAuthGrantOwner) => Promise<Partial<IntegrationOAuthGrantServiceDeps>>
    }
    const unreadableCases: UnreadableCase[] = [
      {
        label: 'a failed DEK pin',
        prepare: async () => ({ kms: createTestKms({ behavior: 'no_dek' }) }),
      },
      {
        label: 'field-level ciphertext the layer cannot open',
        prepare: async () => {
          const grantKms = activeKms
          harness().setKms(createTestKms({ behavior: 'no_dek' }))
          return { kms: grantKms }
        },
      },
      {
        label: 'a grant sealed with another key',
        prepare: async (owner) => {
          await createCredentialsService(fork(), null, { kms: createTestKms() })
            .save(oauthGrantRowId(owner.integrationId), { corrupted: true }, scopeOf(owner))
          return {}
        },
      },
      {
        label: 'a blob that fails the grant schema',
        prepare: async (owner) => {
          await createCredentialsService(fork(), null, { kms: activeKms })
            .save(oauthGrantRowId(owner.integrationId), {}, scopeOf(owner))
          return {}
        },
      },
      {
        label: 'an unreadable Client Configuration',
        prepare: async (owner) => {
          await createCredentialsService(fork(), null, { kms: createTestKms() })
            .save(owner.integrationId, { clientId: server().clientId, clientSecret: server().clientSecret }, scopeOf(owner))
          return {}
        },
      },
    ]

    it.each(unreadableCases)('answers platform_unavailable for $label, with no token call and the grant unchanged (A22)', async ({ prepare }) => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const deps = await prepare(owner)
      const before = await readRawGrantRows(owner)
      reportError.mockClear()

      await expectGrantError(getToken(owner, { deps }), 'platform_unavailable')

      expect(refreshCalls()).toBe(0)
      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE])
    }, CASE_TIMEOUT_MS)

    it('answers a lock deadline transient, degraded while the stored token is valid and never for a rejectedAccessToken call', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner)
      const held = await holdGrantLock(owner)
      try {
        mockWithAdvisoryXactLock.mockImplementation((em, key, fn, options) => (
          actualLock.withAdvisoryXactLock(em, key, fn, { ...options, waitDeadlineMs: 300 })
        ))

        const token = await getToken(owner, { options: { forceRefresh: true } })
        expect(token).toMatchObject({ accessToken: connected.accessToken, degraded: true })
        await expectGrantError(getToken(owner, { options: { rejectedAccessToken: connected.accessToken } }), 'transient')
      } finally {
        await held.release()
      }

      expect(refreshCalls()).toBe(0)
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT, REFRESH_TRANSIENT])
      expect(await readStoredGrant(owner)).toEqual(connected)
    }, CASE_TIMEOUT_MS)

    it('answers a transient database error in the lock section transient and rolls the refresh back', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner)
      failing.grantUpdates = true

      const token = await getToken(owner, { options: { forceRefresh: true } })

      failing.grantUpdates = false
      expect(token).toMatchObject({ accessToken: connected.accessToken, degraded: true })
      expect(refreshCalls()).toBe(1)
      expect(await readStoredGrant(owner)).toEqual(connected)
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT])
    }, CASE_TIMEOUT_MS)
  })

  describe('one refresh per window (A19)', () => {
    it('makes one token call for an expiry refresh racing forceRefresh, rejectedAccessToken and a minValidityMs above the lifetime', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      const gate = createGate()
      const gated = createGatedTokenClient(gate)
      const deps = { tokenClient: gated.client }
      mockWithAdvisoryXactLock.mockClear()

      const expiry = getToken(owner, { deps })
      const racing: Array<Promise<OAuthAccessToken>> = []
      try {
        await gated.entered
        racing.push(
          getToken(owner, { deps, options: { forceRefresh: true } }),
          getToken(owner, { deps, options: { rejectedAccessToken: expired.accessToken } }),
          getToken(owner, { deps, options: { minValidityMs: 2 * HOUR_MS } }),
        )
        await waitFor(() => mockWithAdvisoryXactLock.mock.calls.length === 4, 'the racing calls to reach the Grant Lock')
      } finally {
        gate.open()
      }
      const tokens = await Promise.all([expiry, ...racing])

      const stored = await readStoredGrant(owner)
      expect(tokens.map((token) => token.accessToken)).toEqual([
        stored.accessToken,
        stored.accessToken,
        stored.accessToken,
        stored.accessToken,
      ])
      expect(tokens.map((token) => token.degraded)).toEqual([false, false, false, true])
      expect(gated.stats.calls).toBe(1)
      expect(refreshCalls()).toBe(1)
    }, CASE_TIMEOUT_MS)

    it.each([
      ['transient', { status: 503, body: {} }],
      ['client_misconfigured', { status: 401, body: { error: 'invalid_client' } }],
    ] as Array<[OAuthTokenFailure, RefreshInjection]>)(
      'lets waiters behind a %s holder return it without calling the token endpoint',
      async (code, injection) => {
        const owner = createOwner()
        await connectOwner(owner)
        await expireStoredGrant(owner)
        const gate = createGate()
        const gated = createGatedTokenClient(gate)
        mockWithAdvisoryXactLock.mockClear()

        const holder = outcomeOf(getToken(owner, { deps: { tokenClient: gated.client } }))
        const waiters: Array<Promise<unknown>> = []
        try {
          await gated.entered
          injectRefresh(injection)
          waiters.push(...Array.from({ length: 3 }, () => outcomeOf(getToken(owner, { deps: { tokenClient: gated.client } }))))
          await waitFor(() => mockWithAdvisoryXactLock.mock.calls.length === 4, 'three waiters behind the holder')
        } finally {
          gate.open()
        }
        const outcomes = await Promise.all([holder, ...waiters])

        for (const outcome of outcomes) {
          expect(outcome).toBeInstanceOf(OAuthGrantError)
          expect((outcome as OAuthGrantError).code).toBe(code)
        }
        expect(gated.stats.calls).toBe(1)
        expect(refreshCalls()).toBe(1)
      },
      CASE_TIMEOUT_MS,
    )

    it('never treats a stored token equal to rejectedAccessToken as already refreshed', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner)
      await writeStoredGrant(owner, { ...connected, refreshedAt: new Date(Date.now() + 60_000) })

      const token = await getToken(owner, { options: { rejectedAccessToken: connected.accessToken } })

      expect(token.accessToken).not.toBe(connected.accessToken)
      expect(token.degraded).toBe(false)
      expect(refreshCalls()).toBe(1)
    }, CASE_TIMEOUT_MS)

    it('answers a rejectedAccessToken over an unexpired grant without a refresh token transient with no token, and degraded otherwise', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner, { omitRefreshToken: true, descriptor: { requiresRefreshToken: false } })

      await expectGrantError(getToken(owner, { options: { rejectedAccessToken: connected.accessToken } }), 'transient')
      const forced = await getToken(owner, { options: { forceRefresh: true } })

      expect(forced).toMatchObject({ accessToken: connected.accessToken, degraded: true })
      expect(refreshCalls()).toBe(0)
      expect(await readStoredGrant(owner)).toEqual(connected)
    }, CASE_TIMEOUT_MS)
  })

  describe('rotation and response handling (A20, A21)', () => {
    it.each([
      ['none', { rotation: 'none' }],
      ['non_revoking', { rotation: 'non_revoking' }],
      ['strict with a reuse grace', { rotation: 'strict', strictGraceMs: 60_000 }],
    ] as Array<[string, FakeAuthorizationServerOptions]>)(
      'stores the refresh token rotation %s returns, keeps grantedScopes and never sends scope',
      async (_label, options) => {
        const rotating = await startFakeAuthorizationServer(options)
        try {
          const owner = createOwner()
          const connected = await connectOwner(owner, { authorizationServer: rotating, requestedScopes: ['asked.scope'] })
          expect(connected.grantedScopes).toEqual(['asked.scope'])

          await getToken(owner, { authorizationServer: rotating, options: { forceRefresh: true } })
          await backdateStoredGrant(owner)
          await getToken(owner, { authorizationServer: rotating, options: { forceRefresh: true } })

          const stored = await readStoredGrant(owner)
          const issued = rotating.issuedTokens().refreshTokens
          const rotates = options.rotation !== 'none'
          expect(stored.refreshToken).toBe(rotates ? issued[issued.length - 1] : connected.refreshToken)
          expect(stored).toMatchObject({ grantedScopes: ['asked.scope'], refreshCount: 2, status: 'active' })
          const refreshRequests = rotating.requests().filter((request) => request.params.grant_type === 'refresh_token')
          expect(refreshRequests.map((request) => request.params.refresh_token)).toEqual(
            rotates ? [connected.refreshToken, issued[1]] : [connected.refreshToken, connected.refreshToken],
          )
          for (const request of refreshRequests) expect(request.params).not.toHaveProperty('scope')
        } finally {
          await rotating.close()
        }
      },
      CASE_TIMEOUT_MS,
    )

    it('keeps the stored refresh token when none is returned, takes a returned scope and the default lifetime', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner)
      await expireStoredGrant(owner)
      const injectedAccessToken = hexToken('fake_at_injected_')
      injectRefresh({ status: 200, body: { access_token: injectedAccessToken, token_type: 'bearer', scope: 'narrowed.scope' } })

      const token = await getToken(owner, { descriptor: { defaultAccessTokenTtlSec: 600 } })

      const stored = await readStoredGrant(owner)
      expect(token).toMatchObject({ accessToken: injectedAccessToken, degraded: false, grantedScopes: ['narrowed.scope'] })
      expect(stored).toMatchObject({
        accessToken: injectedAccessToken,
        refreshToken: connected.refreshToken,
        grantedScopes: ['narrowed.scope'],
      })
      expect(stored.expiresAt.getTime() - (stored.refreshedAt?.getTime() ?? 0)).toBe(600_000)
    }, CASE_TIMEOUT_MS)

    it('clamps an expires_in of 0 to one second and answers the refreshed token within half its lifetime', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const injectedAccessToken = hexToken('fake_at_injected_')
      injectRefresh({ status: 200, body: { access_token: injectedAccessToken, token_type: 'Bearer', expires_in: 0 } })
      const startedAt = Date.now()

      const token = await getToken(owner)

      const stored = await readStoredGrant(owner)
      expect(token).toMatchObject({ accessToken: injectedAccessToken, expiresAt: stored.expiresAt, degraded: false })
      expect(token.expiresAt.getTime()).toBeGreaterThan(startedAt)
      expect(stored.expiresAt.getTime() - (stored.refreshedAt?.getTime() ?? 0)).toBe(1000)
      expect(refreshCalls()).toBe(1)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('caps the default refresh margin at half the token lifetime, so a short-lived token is not refreshed on every call', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const injectedAccessToken = hexToken('fake_at_injected_')
      injectRefresh({ status: 200, body: { access_token: injectedAccessToken, token_type: 'Bearer', expires_in: 60 } })
      const descriptor = { refreshSkewMs: 120_000 }

      const tokens = [
        await getToken(owner, { descriptor }),
        await getToken(owner, { descriptor }),
        await getToken(owner, { descriptor }),
      ]

      expect(tokens.map((token) => token.accessToken)).toEqual([injectedAccessToken, injectedAccessToken, injectedAccessToken])
      expect(tokens.every((token) => !token.degraded)).toBe(true)
      expect(refreshCalls()).toBe(1)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('clamps a huge expires_in to one year and keeps the rotated refresh token', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const injectedAccessToken = hexToken('fake_at_injected_')
      const rotatedRefreshToken = hexToken('fake_rt_rotated_')
      injectRefresh({
        status: 200,
        body: { access_token: injectedAccessToken, token_type: 'Bearer', expires_in: 1e20, refresh_token: rotatedRefreshToken },
      })

      const token = await getToken(owner)

      const stored = await readStoredGrant(owner)
      expect(token).toMatchObject({ accessToken: injectedAccessToken, expiresAt: stored.expiresAt, degraded: false })
      expect(stored).toMatchObject({
        status: 'active',
        accessToken: injectedAccessToken,
        refreshToken: rotatedRefreshToken,
        refreshCount: 1,
        lastFailureClass: null,
      })
      expect(stored.expiresAt.getTime() - (stored.refreshedAt?.getTime() ?? 0)).toBe(YEAR_MS)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('persists only the refresh token of a 200 whose access token is unusable, and answers transient (A21)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      const salvaged = hexToken('fake_rt_salvaged_')
      injectRefresh({ status: 200, body: { refresh_token: salvaged, token_type: 'Bearer', expires_in: 3600 } })

      await expectGrantError(getToken(owner), 'transient')

      expect(await readStoredGrant(owner)).toEqual({
        ...expired,
        refreshToken: salvaged,
        lastFailureClass: 'transient',
        lastFailureAt: expect.any(Date),
      })
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT])
      expectNoIssuedToken(reportError.mock.calls, [salvaged])
      expectNoIssuedToken(await readRawGrantRows(owner), [salvaged])
    }, CASE_TIMEOUT_MS)
  })

  describe('commit outcome unknown after a token call', () => {
    function failCommitOnce(committed: boolean, beforeAnswer: () => Promise<unknown> = async () => undefined): void {
      const rolledBack = new Error('[internal] simulated failed commit')
      mockWithAdvisoryXactLock.mockImplementationOnce(async (em, key, fn, options) => {
        if (committed) {
          await actualLock.withAdvisoryXactLock(em, key, fn, options)
        } else {
          await actualLock.withAdvisoryXactLock(em, key, async (txEm) => {
            await fn(txEm)
            throw rolledBack
          }, options).catch((error: unknown) => {
            if (error !== rolledBack) throw error
          })
        }
        await beforeAnswer()
        throw new AdvisoryLockUnavailableError('commit_unknown', key, simulatedLockTimeout())
      })
    }

    it('answers the refreshed token when the refresh committed, with one token call', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      failCommitOnce(true)

      const token = await getToken(owner)

      const stored = await readStoredGrant(owner)
      expect(token).toMatchObject({ accessToken: stored.accessToken, degraded: false })
      expect(stored).toMatchObject({ status: 'active', refreshCount: 1 })
      expect(refreshCalls()).toBe(1)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('stores the rotated tokens again when the refresh rolled back, so a strict provider accepts the next refresh', async () => {
      const rotating = await startFakeAuthorizationServer({ rotation: 'strict' })
      try {
        const owner = createOwner()
        const connected = await connectOwner(owner, { authorizationServer: rotating })
        await expireStoredGrant(owner)
        failCommitOnce(false)

        const token = await getToken(owner, { authorizationServer: rotating })

        const stored = await readStoredGrant(owner)
        const issued = rotating.issuedTokens().refreshTokens
        expect(token).toMatchObject({ accessToken: stored.accessToken, degraded: false })
        expect(stored).toMatchObject({ status: 'active', refreshCount: 1, refreshToken: issued[issued.length - 1] })
        expect(stored.refreshToken).not.toBe(connected.refreshToken)

        await getToken(owner, { authorizationServer: rotating, options: { forceRefresh: true } })

        expect(await readStoredGrant(owner)).toMatchObject({ status: 'active', refreshCount: 2 })
        expect(await readLogs(owner, INVALIDATED)).toEqual([])
        expect(reportError).not.toHaveBeenCalled()
      } finally {
        await rotating.close()
      }
    }, CASE_TIMEOUT_MS)

    it('stores a salvaged refresh token again when its transient answer rolled back', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      const salvaged = hexToken('fake_rt_salvaged_')
      injectRefresh({ status: 200, body: { refresh_token: salvaged, token_type: 'Bearer', expires_in: 3600 } })
      failCommitOnce(false)

      await expectGrantError(getToken(owner), 'transient')

      expect(await readStoredGrant(owner)).toEqual({
        ...expired,
        refreshToken: salvaged,
        lastFailureClass: 'transient',
        lastFailureAt: expect.any(Date),
      })
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('answers the grant another writer stored before the outcome was resolved', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const expired = await expireStoredGrant(owner)
      const reconnectedAccessToken = hexToken('fake_at_reconnected_')
      failCommitOnce(false, () => writeStoredGrant(owner, {
        ...expired,
        accessToken: reconnectedAccessToken,
        expiresAt: new Date(Date.now() + HOUR_MS),
      }))

      const token = await getToken(owner)

      expect(token).toMatchObject({ accessToken: reconnectedAccessToken, degraded: false })
      expect(await readStoredGrant(owner)).toMatchObject({ accessToken: reconnectedAccessToken, refreshCount: 0 })
      expect(refreshCalls()).toBe(1)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)
  })

  describe('bounded lock (A22, A23)', () => {
    it('keeps a refresh made inside a rolled-back outer transaction', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const requestEm = fork()
      const service = createIntegrationOAuthGrantService({ em: requestEm })
      const captured: { token: OAuthAccessToken | null } = { token: null }

      await expect(requestEm.transactional(async () => {
        captured.token = await service.getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })
        throw new Error('[internal] roll back the outer transaction')
      })).rejects.toThrow('roll back the outer transaction')

      expect(captured.token?.degraded).toBe(false)
      expect((await readStoredGrant(owner)).accessToken).toBe(captured.token?.accessToken)
      expect(refreshCalls()).toBe(1)
    }, CASE_TIMEOUT_MS)

    it('completes a refresh inside an outer transaction that saved credentials of the same scope over a canonical map', async () => {
      const owner = createOwner()
      const connected = await connectOwner(owner)
      const requestEm = fork()
      const service = createIntegrationOAuthGrantService({ em: requestEm })

      const token = await requestEm.transactional(async (outer) => {
        await createCredentialsService(outer).save(
          INTEGRATION_ID,
          { clientId: server().clientId, clientSecret: server().clientSecret },
          scopeOf(owner),
        )
        return service.getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })
      })

      expect(token.accessToken).not.toBe(connected.accessToken)
      expect((await readStoredGrant(owner)).accessToken).toBe(token.accessToken)
    }, CASE_TIMEOUT_MS)

    it('runs the deferred map invalidation of a committed grant_invalidated before the throw', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      await fork().execute(
        `update "encryption_maps" set "is_active" = false
         where "entity_id" = ? and "tenant_id" = ? and "organization_id" = ?`,
        [CREDENTIALS_ENTITY_ID, owner.tenantId, owner.organizationId],
      )
      const invalidateMap = jest.fn(async () => undefined)
      injectRefresh({ status: 400, body: { error: 'invalid_grant' } })
      let invalidationsBeforeThrow = -1

      const error = await getToken(owner, { deps: { encryptionService: { invalidateMap } } }).then(
        () => null,
        (failure: unknown) => {
          invalidationsBeforeThrow = invalidateMap.mock.calls.length
          return failure
        },
      )

      expect(error).toBeInstanceOf(OAuthGrantError)
      expect((error as OAuthGrantError).code).toBe('grant_invalidated')
      expect(invalidationsBeforeThrow).toBe(1)
      expect(invalidateMap).toHaveBeenCalledWith(CREDENTIALS_ENTITY_ID, owner.tenantId, owner.organizationId)
      expect((await readScopeMapRows(owner)).map((row) => row.is_active)).toEqual([true])
      expect((await readStoredGrant(owner)).status).toBe('invalidated')
    }, CASE_TIMEOUT_MS)

    it('refreshes with pool max 1 without an acquire timeout', async () => {
      const single = await harness().openPool({ poolMax: 1 })
      try {
        const owner = createOwner()
        await connectOwner(owner)
        await expireStoredGrant(owner)

        const token = await createIntegrationOAuthGrantService({ em: single.em.fork() }).getAccessToken(descriptorOf(owner), owner)

        expect(token.degraded).toBe(false)
        expect(token.accessToken).toBe(server().issuedTokens().accessTokens[1])
        expect(reportError).not.toHaveBeenCalled()
      } finally {
        await single.close()
      }
    }, CASE_TIMEOUT_MS)

    it('answers platform_unavailable with no DEK before any Grant Lock attempt and calls no KMS after the failed resolution (A23)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const noDekKms = createTestKms({ behavior: 'no_dek' })
      mockWithAdvisoryXactLock.mockClear()

      await expectGrantError(getToken(owner, { deps: { kms: noDekKms } }), 'platform_unavailable')

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(noDekKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1 })
      expect(refreshCalls()).toBe(0)
      expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE])
    }, CASE_TIMEOUT_MS)

    it('resolves the DEK once while it backs off several times behind a held Grant Lock (A23)', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      const pinKms = countingKms(activeKms)
      let waits = 0
      mockWithAdvisoryXactLock.mockImplementationOnce((em, key, fn, options) => actualLock.withAdvisoryXactLock(em, key, fn, {
        ...options,
        onWait: async () => {
          waits += 1
          return options?.onWait ? options.onWait() : { done: false }
        },
      }))
      const held = await holdGrantLock(owner)

      const refreshing = getToken(owner, { deps: { kms: pinKms } })
      try {
        await waitFor(() => waits >= 3, 'three back-offs behind the held lock')
      } finally {
        await held.release()
      }
      const token = await refreshing

      expect(token.degraded).toBe(false)
      expect(pinKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 0 })
      expect(refreshCalls()).toBe(1)
    }, CASE_TIMEOUT_MS)

    it('answers transient for a waiter at its deadline and for a holder whose session ends during a stalled KMS lookup (A24)', async () => {
      const stalling = await harness().openPool({ idleInTransactionTimeoutMs: 3_000 })
      const fieldKms = createStallingKms(activeKms)
      try {
        const owner = createOwner()
        await connectOwner(owner)
        const expired = await expireStoredGrant(owner)
        harness().setKms(fieldKms)
        const tokenClient: TokenClient = {
          async requestTokenEndpoint(input) {
            const response = await requestTokenEndpoint(input)
            harness().encryption.invalidateDek(owner.tenantId)
            fieldKms.stallNextLookup()
            return response
          },
          revokeToken,
        }

        const holder = outcomeOf(
          createIntegrationOAuthGrantService({ em: stalling.em.fork(), kms: activeKms, tokenClient })
            .getAccessToken(descriptorOf(owner), owner),
        )
        await fieldKms.stalled
        mockWithAdvisoryXactLock.mockImplementationOnce((em, key, fn, options) => (
          actualLock.withAdvisoryXactLock(em, key, fn, { ...options, waitDeadlineMs: 500 })
        ))
        await expectGrantError(
          createIntegrationOAuthGrantService({ em: stalling.em.fork(), kms: activeKms }).getAccessToken(descriptorOf(owner), owner),
          'transient',
        )
        await waitFor(() => isGrantLockFree(owner), 'Postgres to end the stalled holder session', 15_000)
        fieldKms.release()
        const holderOutcome = await holder

        expect(holderOutcome).toBeInstanceOf(OAuthGrantError)
        expect((holderOutcome as OAuthGrantError).code).toBe('transient')
        expect(await readStoredGrant(owner)).toEqual(expired)
        expect(refreshCalls()).toBe(1)
        const matchedConnectionErrors = mockIsTransientLockDbError.mock.calls.filter(([error], index) => (
          mockIsTransientLockDbError.mock.results[index]?.value === true && errorChainMatches(error, /not queryable/)
        ))
        expect(matchedConnectionErrors.length).toBeGreaterThanOrEqual(1)
        expect(reportedCodes()).toEqual([REFRESH_TRANSIENT, REFRESH_TRANSIENT])
      } finally {
        fieldKms.release()
        await stalling.close()
      }
    }, CASE_TIMEOUT_MS)
  })

  describe('invalidation logs (A25)', () => {
    it('writes one oauth_invalidated for 20 concurrent callers rejected with invalid_grant', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await expireStoredGrant(owner)
      server().revokeAuthorization()

      const outcomes = await Promise.all(Array.from({ length: 20 }, () => outcomeOf(getToken(owner))))

      for (const outcome of outcomes) {
        expect(outcome).toBeInstanceOf(OAuthGrantError)
        expect(outcome).toMatchObject({ code: 'grant_invalidated', reason: 'grant_rejected' })
      }
      expect(await readLogs(owner, INVALIDATED)).toEqual([
        { code: INVALIDATED, level: 'warn', payload: { reason: 'grant_rejected' } },
      ])
      expect(refreshCalls()).toBe(1)
      expect((await readStoredGrant(owner)).status).toBe('invalidated')
    }, CASE_TIMEOUT_MS)

    it.each([
      ['grant_rejected', async (owner: OAuthGrantOwner) => {
        await connectOwner(owner)
        await expireStoredGrant(owner)
        injectRefresh({ status: 400, body: { error: 'invalid_grant' } })
      }],
      ['no_refresh_token', async (owner: OAuthGrantOwner) => {
        await connectOwner(owner, { omitRefreshToken: true, descriptor: { requiresRefreshToken: false } })
        await expireStoredGrant(owner)
      }],
    ])('answers transient and commits neither the status nor the entry when the oauth_invalidated write fails (%s)', async (_label, prepare) => {
      const owner = createOwner()
      await prepare(owner)
      const before = await readStoredGrant(owner)
      failing.logCode = INVALIDATED

      await expectGrantError(getToken(owner), 'transient')

      failing.logCode = null
      expect(await readStoredGrant(owner)).toEqual(before)
      expect(await readLogs(owner, INVALIDATED)).toEqual([])
      expect(reportedCodes()).toEqual([REFRESH_TRANSIENT])
    }, CASE_TIMEOUT_MS)
  })

  describe('holder cap (A40)', () => {
    it('holds at most 4 Grant Lock transactions per process and queues further refreshes without a connection', async () => {
      const pool = await harness().openPool({ poolMax: 6, acquireTimeoutMs: 1_000 })
      const gate = createGate()
      const gated = createGatedTokenClient(gate)
      const refreshes: Array<Promise<OAuthAccessToken>> = []
      try {
        const owners = Array.from({ length: 8 }, () => createOwner())
        const otherOwner = createOwner(SECOND_INTEGRATION_ID)
        for (const owner of [...owners, otherOwner]) await connectOwner(owner)
        const refresh = (owner: OAuthGrantOwner) => createIntegrationOAuthGrantService({ em: pool.em.fork(), tokenClient: gated.client })
          .getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })

        refreshes.push(...owners.map(refresh))
        await waitFor(
          () => gated.stats.inFlight === 4 && grantLockSlots().waiting === 4,
          'four lock holders and four refreshes queued for a slot',
        )
        const lockRows = await pool.em.fork().execute<Array<{ count: number }>>(
          `select count(*)::int as "count" from pg_locks where locktype = 'advisory' and granted`,
        )
        expect(lockRows[0]?.count).toBe(4)
        refreshes.push(refresh(otherOwner))
        await waitFor(() => grantLockSlots().waiting === 5, 'the second integration refresh to queue for a slot')
        const filled = await occupyConnections(pool.em, 2)
        await filled.release()
        gate.open()
        const tokens = await Promise.all(refreshes)

        expect(tokens.every((token) => !token.degraded)).toBe(true)
        expect(new Set(tokens.map((token) => token.accessToken)).size).toBe(9)
        expect(gated.stats.maxInFlight).toBe(4)
        expect(gated.stats.calls).toBe(9)
        expect(grantLockSlots()).toEqual({ held: 0, waiting: 0 })
        expect(reportError).not.toHaveBeenCalled()
      } finally {
        gate.open()
        await Promise.allSettled(refreshes)
        await pool.close()
      }
    }, CASE_TIMEOUT_MS)
  })
})
