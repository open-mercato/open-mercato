import { randomUUID } from 'node:crypto'
import type { EventSubscriber } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError, type CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AdvisoryLockUnavailableError, withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { IntegrationCredentials } from '../../../data/entities'
import { emitIntegrationsEvent } from '../../../events'
import { createTestKms, startPgTestOrm, type PgTestOrm, type TestKms } from '../../../__tests__/support/pgTestOrm'
import {
  createCredentialsService,
  eraseIntegrationCredentials,
  readCredentialRowLayered,
} from '../../credentials-service'
import { exchangeAuthorizationCode } from '../authorization'
import {
  OAuthDescriptorError,
  OAuthGrantError,
  type OAuthGrantOwner,
  type OAuthProviderDescriptor,
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
  type OAuthConnectResult,
  type OAuthDisconnectResult,
} from '../grant-service'
import { mapInspectionToHealth, OAUTH_HEALTH_CODES } from '../health'
import { createPkcePair } from '../pkce'
import type { OAuthTokenEndpointResponse } from '../token-endpoint'
import { startFakeAuthorizationServer, type FakeAuthorizationServer } from '../testing/fakeAuthorizationServer'

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

jest.mock('../../credentials-service', () => {
  const actual = jest.requireActual<typeof import('../../credentials-service')>('../../credentials-service')
  return { ...actual, readCredentialRowLayered: jest.fn(actual.readCredentialRowLayered) }
})

jest.mock('../../../events', () => ({
  ...jest.requireActual<typeof import('../../../events')>('../../../events'),
  emitIntegrationsEvent: jest.fn(),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 20_000
const INTEGRATION_ID = 'test_oauth_grant'
const SECOND_INTEGRATION_ID = 'test_oauth_grant_second'
const GRANT_ROW_ID = oauthGrantRowId(INTEGRATION_ID)
const ENVELOPE_KEY = '__om_encrypted_credentials_blob_v1'
const DEFAULT_SCOPES = ['test.read', 'test.write']
const REDIRECT_URI = 'http://127.0.0.1/callback'
const ACTOR_USER_ID = '99999999-9999-4999-8999-999999999999'
const STALE_REVISION = '2000-01-01T00:00:00.000Z'
const CONNECTED = 'integrations.oauth_connected'
const EXTERNAL_ACCOUNT_SELECTED = 'integrations.oauth_external_account_selected'
const DISCONNECTED = 'integrations.oauth_disconnected'
const REVOCATION_PENDING = 'integrations.oauth_revocation_pending'
const REVOCATION_CONFIRMED = 'integrations.oauth_revocation_confirmed'
const REVOCATION_FAILED = 'integrations.oauth_revocation_failed'
const REVOCATION_UNSUPPORTED = 'integrations.oauth_revocation_unsupported'
const REVOCATION_SKIPPED_RECONNECTED = 'integrations.oauth_revocation_skipped_reconnected'
const REVOCATION_SKIPPED_INVALIDATED = 'integrations.oauth_revocation_skipped_invalidated'
const PLATFORM_UNAVAILABLE = 'integrations.oauth_platform_unavailable'
const WRITE_TRANSIENT = 'integrations.oauth_write_transient'
const LOG_WRITE_FAILED = 'integrations.oauth_log_write_failed'

const actualLock = jest.requireActual<typeof import('@open-mercato/shared/lib/db/advisoryLock')>(
  '@open-mercato/shared/lib/db/advisoryLock',
)
const actualCredentials = jest.requireActual<typeof import('../../credentials-service')>('../../credentials-service')
const mockWithAdvisoryXactLock = withAdvisoryXactLock as jest.MockedFunction<typeof withAdvisoryXactLock>
const mockReadCredentialRowLayered = readCredentialRowLayered as jest.MockedFunction<typeof readCredentialRowLayered>
const mockEmitIntegrationsEvent = emitIntegrationsEvent as jest.MockedFunction<typeof emitIntegrationsEvent>

type DisconnectOptions = Parameters<IntegrationOAuthGrantService['disconnect']>[2]
type RawCredentialRow = { id: string; credentials: string; deleted_at: string | null }
type LogRow = { code: string; level: string; payload: Record<string, unknown> | null }
type Gate = { promise: Promise<void>; open(): void }
type HeldLock = { release(): Promise<void> }
type CountingKms = KmsService & { calls: { getTenantDek: number; createTenantDek: number } }
type ConnectedOwner = { result: OAuthConnectResult; grant: OAuthGrantRecord }
type DisconnectCall = {
  options?: Partial<DisconnectOptions>
  deps?: Partial<IntegrationOAuthGrantServiceDeps>
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

async function waitFor(condition: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
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

function parseRawCredentials(row: RawCredentialRow | undefined): unknown {
  return row ? JSON.parse(row.credentials) : undefined
}

async function expectGrantError(promise: Promise<unknown>, code: string): Promise<OAuthGrantError> {
  const error = await outcomeOf(promise)
  expect(error).toBeInstanceOf(OAuthGrantError)
  expect((error as OAuthGrantError).code).toBe(code)
  return error as OAuthGrantError
}

async function expectDescriptorError(promise: Promise<unknown>, field: string): Promise<void> {
  const error = await outcomeOf(promise)
  expect(error).toBeInstanceOf(OAuthDescriptorError)
  expect((error as OAuthDescriptorError).field).toBe(field)
}

function expectErased(result: OAuthDisconnectResult): Extract<OAuthDisconnectResult, { erased: true }> {
  if (!result.erased) throw new Error('[internal] expected an erased grant')
  expect(result.disconnectId).toMatch(/^[0-9a-f-]{36}$/)
  return result
}

describeWithPostgres('integrationOAuthGrantService disconnect against real PostgreSQL', () => {
  let pg: PgTestOrm | null = null
  let fake: FakeAuthorizationServer | null = null
  let activeKms: TestKms = createTestKms()
  let unregisterTelemetry: (() => void) | null = null
  const reportError = jest.fn<void, Parameters<TelemetryRuntime['reportError']>>()
  const failing = { grantUpdates: false }

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

  function descriptorOf(owner: OAuthGrantOwner, overrides: Partial<OAuthProviderDescriptor> = {}): OAuthProviderDescriptor {
    const authorizationServer = server()
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

  function disconnect(owner: OAuthGrantOwner, call: DisconnectCall = {}): Promise<OAuthDisconnectResult> {
    return createService(call.deps).disconnect(descriptorOf(owner, call.descriptor), owner, {
      expectedRevisedAt: null,
      ...call.options,
    })
  }

  async function configureClient(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork()).save(
      owner.integrationId,
      { clientId: server().clientId, clientSecret: server().clientSecret },
      scopeOf(owner),
    )
  }

  async function obtainTokens(scope: string[] = DEFAULT_SCOPES): Promise<OAuthTokenEndpointResponse> {
    const pkce = createPkcePair()
    const code = server().issueAuthorizationCode({ redirectUri: REDIRECT_URI, scope, codeChallenge: pkce.codeChallenge })
    return exchangeAuthorizationCode(
      descriptorOf(createOwner()),
      { clientId: server().clientId, clientSecret: server().clientSecret },
      { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier },
    )
  }

  async function readStoredGrant(owner: OAuthGrantOwner): Promise<OAuthGrantRecord> {
    const read = await actualCredentials.readCredentialRowLayered(fork(), oauthGrantRowId(owner.integrationId), scopeOf(owner), {
      kms: activeKms,
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

  async function connectWith(owner: OAuthGrantOwner, tokens: OAuthTokenEndpointResponse): Promise<OAuthConnectResult> {
    return createService().completeConnect(descriptorOf(owner), owner, tokens, {
      clientId: server().clientId,
      actorUserId: ACTOR_USER_ID,
    })
  }

  async function connectOwner(owner: OAuthGrantOwner, input: { configure?: boolean } = {}): Promise<ConnectedOwner> {
    if (input.configure !== false) await configureClient(owner)
    const result = await connectWith(owner, await obtainTokens())
    return { result, grant: await readStoredGrant(owner) }
  }

  async function corruptEnvelope(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork(), null, { kms: createTestKms() }).save(GRANT_ROW_ID, { corrupted: true }, scopeOf(owner))
  }

  async function sealEmptyBlob(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork(), null, { kms: activeKms }).save(GRANT_ROW_ID, {}, scopeOf(owner))
  }

  async function writeRawGrant(owner: OAuthGrantOwner, credentials: unknown): Promise<void> {
    await fork().execute(
      `insert into "integration_credentials"
         ("id", "integration_id", "credentials", "organization_id", "tenant_id", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?::jsonb, ?, ?, now(), now())`,
      [GRANT_ROW_ID, JSON.stringify(credentials), owner.organizationId, owner.tenantId],
    )
  }

  async function readRawRows(owner: OAuthGrantOwner, integrationId: string = oauthGrantRowId(owner.integrationId)): Promise<RawCredentialRow[]> {
    return fork().execute<RawCredentialRow[]>(
      `select "id", "credentials"::text as "credentials", "deleted_at"
       from "integration_credentials"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by ("deleted_at" is null) asc, "created_at" asc`,
      [integrationId, owner.tenantId, owner.organizationId],
    )
  }

  async function readTombstoneCredentials(owner: OAuthGrantOwner): Promise<unknown> {
    const tombstone = await findOneWithDecryption(
      fork(),
      IntegrationCredentials,
      {
        integrationId: oauthGrantRowId(owner.integrationId),
        tenantId: owner.tenantId,
        organizationId: owner.organizationId,
        deletedAt: { $ne: null },
      },
      undefined,
      scopeOf(owner),
    )
    return tombstone?.credentials
  }

  async function readLogs(owner: OAuthGrantOwner, codes?: string[]): Promise<LogRow[]> {
    const rows = await fork().execute<LogRow[]>(
      `select "code", "level", "payload" from "integration_logs"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by "created_at" asc, "code" asc`,
      [owner.integrationId, owner.tenantId, owner.organizationId],
    )
    return codes ? rows.filter((row) => codes.includes(row.code)) : rows
  }

  async function readDisconnectLogs(owner: OAuthGrantOwner): Promise<LogRow[]> {
    const order = [DISCONNECTED, REVOCATION_PENDING]
    const rows = (await readLogs(owner)).filter((row) => row.code === DISCONNECTED || row.code.startsWith('integrations.oauth_revocation_'))
    return rows.sort((left, right) => {
      const leftRank = order.includes(left.code) ? order.indexOf(left.code) : order.length
      const rightRank = order.includes(right.code) ? order.indexOf(right.code) : order.length
      return leftRank - rightRank
    })
  }

  async function holdGrantLock(owner: OAuthGrantOwner): Promise<HeldLock> {
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

  function revokeRequests(): Array<Readonly<Record<string, string>>> {
    return server().requests().filter((request) => request.endpoint === 'revoke').map((request) => request.params)
  }

  function reportedCodes(): string[] {
    return reportError.mock.calls.map(([, context]) => context?.code ?? '')
  }

  function expectNoIssuedToken(value: unknown): void {
    const serialized = JSON.stringify(value, (_key, entry: unknown) => (
      entry instanceof Error ? { name: entry.name, message: entry.message, cause: entry.cause } : entry
    ))
    const issued = server().issuedTokens()
    for (const token of [...issued.accessTokens, ...issued.refreshTokens]) expect(serialized).not.toContain(token)
  }

  beforeAll(async () => {
    pg = await startPgTestOrm()
    fake = await startFakeAuthorizationServer({ rotation: 'strict' })
    const failingGrantSubscriber: EventSubscriber<IntegrationCredentials> = {
      getSubscribedEntities: () => [IntegrationCredentials],
      beforeUpdate: (args) => {
        if (failing.grantUpdates && args.entity.integrationId.endsWith('__oauth_grant')) throw simulatedLockTimeout()
      },
    }
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
    failing.grantUpdates = false
    reportError.mockClear()
    mockEmitIntegrationsEvent.mockClear()
    mockWithAdvisoryXactLock.mockReset()
    mockWithAdvisoryXactLock.mockImplementation(actualLock.withAdvisoryXactLock)
    mockReadCredentialRowLayered.mockReset()
    mockReadCredentialRowLayered.mockImplementation(actualCredentials.readCredentialRowLayered)
    server().reset()
    activeKms = createTestKms()
    harness().setKms(activeKms)
  })

  afterAll(async () => {
    unregisterTelemetry?.()
    await fake?.close()
    await pg?.close()
  }, 30_000)

  describe('erase and revocation (A29, A25)', () => {
    it('erases under the lock with both entries in one commit, then revokes the refresh token; no grant write emits an event', async () => {
      const owner = createOwner()
      const { result: connected, grant } = await connectOwner(owner)
      const updated = await createService().updateProviderData(descriptorOf(owner), owner, { externalAccountId: 'acct-1' }, {
        expectedRevisedAt: connected.revisedAt,
        actorUserId: ACTOR_USER_ID,
      })
      await createService().getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })
      const refreshed = await readStoredGrant(owner)
      mockWithAdvisoryXactLock.mockClear()

      const result = expectErased(await disconnect(owner, {
        options: { expectedRevisedAt: updated.revisedAt.toISOString(), actorUserId: ACTOR_USER_ID },
      }))

      expect(result).toEqual({ erased: true, disconnectId: result.disconnectId, revocation: 'confirmed', failureReason: null })
      expect(mockWithAdvisoryXactLock).toHaveBeenCalledTimes(1)
      expect(mockWithAdvisoryXactLock).toHaveBeenCalledWith(
        expect.anything(),
        oauthGrantLockKey(owner),
        expect.any(Function),
        { waitDeadlineMs: 5_000, maxConcurrentHolders: 4 },
      )
      const rows = await readRawRows(owner)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.deleted_at).not.toBeNull()
      expectNoIssuedToken(rows)
      expect(await readTombstoneCredentials(owner)).toEqual({})
      expect(revokeRequests()).toEqual([{ token: refreshed.refreshToken, token_type_hint: 'refresh_token' }])
      expect(refreshed.refreshToken).not.toBe(grant.refreshToken)

      expect(await readLogs(owner, [CONNECTED, EXTERNAL_ACCOUNT_SELECTED])).toEqual([
        { code: CONNECTED, level: 'info', payload: expect.objectContaining({ actorUserId: ACTOR_USER_ID }) },
        { code: EXTERNAL_ACCOUNT_SELECTED, level: 'info', payload: { providerDataKeys: ['externalAccountId'], actorUserId: ACTOR_USER_ID } },
      ])
      expect(await readDisconnectLogs(owner)).toEqual([
        { code: DISCONNECTED, level: 'info', payload: { disconnectId: result.disconnectId, actorUserId: ACTOR_USER_ID } },
        { code: REVOCATION_PENDING, level: 'warn', payload: { disconnectId: result.disconnectId } },
        { code: REVOCATION_CONFIRMED, level: 'info', payload: { disconnectId: result.disconnectId } },
      ])
      expect(await readLogs(owner)).toHaveLength(5)
      expectNoIssuedToken(await readLogs(owner))
      expectNoIssuedToken(result)

      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)
      expect(inspection).toEqual({
        status: 'none',
        connectionState: 'not_connected',
        unavailableReason: null,
        baseUrlMissing: false,
        lastDisconnect: { at: expect.any(Date), disconnectId: result.disconnectId, revocation: 'confirmed' },
      })
      const health = mapInspectionToHealth(inspection)
      expect(health).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.notConnected } })
      expectNoIssuedToken(health)
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBeNull()
      await expectGrantError(createService().getAccessToken(descriptorOf(owner), owner), 'not_connected')
      await expectGrantError(
        createService().updateProviderData(descriptorOf(owner), owner, { externalAccountId: 'acct-2' }, { expectedRevisedAt: null }),
        'not_connected',
      )
      expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('keeps the erase when revocation is down: no decryptable refresh token, and the provider code in oauth_revocation_failed', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      server().inject({ endpoint: 'revoke', status: 503, body: { error: 'temporarily_unavailable' } })

      const result = expectErased(await disconnect(owner))

      expect(result).toMatchObject({ revocation: 'failed', failureReason: 'temporarily_unavailable' })
      const rows = await readRawRows(owner)
      expect(rows.map((row) => row.deleted_at === null)).toEqual([false])
      expect(rows[0]?.credentials).not.toContain(String(grant.refreshToken))
      expect(await readTombstoneCredentials(owner)).toEqual({})
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBeNull()
      expect(await readDisconnectLogs(owner)).toEqual([
        { code: DISCONNECTED, level: 'info', payload: { disconnectId: result.disconnectId, actorUserId: null } },
        { code: REVOCATION_PENDING, level: 'warn', payload: { disconnectId: result.disconnectId } },
        {
          code: REVOCATION_FAILED,
          level: 'error',
          payload: { disconnectId: result.disconnectId, failureReason: 'temporarily_unavailable' },
        },
      ])
      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)
      expect(inspection).toMatchObject({ status: 'none', lastDisconnect: { disconnectId: result.disconnectId, revocation: 'failed' } })
      expect(reportedCodes()).toEqual([REVOCATION_FAILED])
      expectNoIssuedToken(reportError.mock.calls)
    }, CASE_TIMEOUT_MS)

    it('leaves oauth_revocation_pending without an outcome when the post-release log writer fails', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const writeDetachedLog = jest.fn(async () => {
        throw new Error('[internal] simulated detached log failure')
      })

      const result = expectErased(await disconnect(owner, { deps: { writeDetachedLog } }))

      expect(result).toMatchObject({ revocation: 'confirmed', failureReason: null })
      expect(writeDetachedLog).toHaveBeenCalledTimes(1)
      expect((await readDisconnectLogs(owner)).map((row) => row.code)).toEqual([DISCONNECTED, REVOCATION_PENDING])
      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)
      expect(inspection).toMatchObject({ status: 'none', lastDisconnect: { disconnectId: result.disconnectId, revocation: 'pending' } })
      expect(reportedCodes()).toEqual([LOG_WRITE_FAILED])
    }, CASE_TIMEOUT_MS)

    it('skips the cleanup when a quick Connect commits right after the erase, and the new grant works', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const reconnected: { result: OAuthConnectResult | null } = { result: null }
      mockWithAdvisoryXactLock.mockImplementationOnce(async (em, key, fn, options) => {
        const value = await actualLock.withAdvisoryXactLock(em, key, fn, options)
        reconnected.result = await connectWith(owner, await obtainTokens())
        return value
      })

      const result = expectErased(await disconnect(owner))

      expect(result).toMatchObject({ revocation: 'skipped_reconnected', failureReason: null })
      expect(reconnected.result).toMatchObject({ reconnect: false })
      expect(revokeRequests()).toEqual([])
      expect((await readDisconnectLogs(owner)).at(-1)).toEqual({
        code: REVOCATION_SKIPPED_RECONNECTED,
        level: 'info',
        payload: { disconnectId: result.disconnectId },
      })
      expect((await readRawRows(owner)).map((row) => row.deleted_at === null)).toEqual([false, true])
      const token = await createService().getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })
      expect(token.degraded).toBe(false)
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBe('active')
    }, CASE_TIMEOUT_MS)

    it('answers erased: false without a live grant, writing no log entry, also after an earlier Disconnect', async () => {
      const neverConnected = createOwner()
      await configureClient(neverConnected)

      expect(await disconnect(neverConnected)).toEqual({ erased: false, reason: 'not_connected' })
      expect(await readRawRows(neverConnected)).toEqual([])
      expect(await readDisconnectLogs(neverConnected)).toEqual([])

      const disconnected = createOwner()
      await connectOwner(disconnected)
      expectErased(await disconnect(disconnected))
      const rows = await readRawRows(disconnected)
      const logs = await readDisconnectLogs(disconnected)
      const revokes = revokeRequests().length

      expect(await disconnect(disconnected, { options: { force: true } })).toEqual({ erased: false, reason: 'not_connected' })
      expect(await readRawRows(disconnected)).toEqual(rows)
      expect(await readDisconnectLogs(disconnected)).toEqual(logs)
      expect(revokeRequests()).toHaveLength(revokes)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)
  })

  describe('without readable tokens (A30, A26)', () => {
    type UnreadableCase = {
      label: string
      prepare: (owner: OAuthGrantOwner) => Promise<Partial<IntegrationOAuthGrantServiceDeps>>
    }
    const unreadableCases: UnreadableCase[] = [
      {
        label: 'an envelope sealed with another key',
        prepare: async (owner) => {
          await corruptEnvelope(owner)
          return {}
        },
      },
      {
        label: 'a blob that decrypts to {}',
        prepare: async (owner) => {
          await sealEmptyBlob(owner)
          return {}
        },
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
        label: 'a failed DEK pin',
        prepare: async () => ({ kms: createTestKms({ behavior: 'no_dek' }) }),
      },
    ]
    const defaultCases = unreadableCases.flatMap((unreadableCase) => (
      [STALE_REVISION, null].map((expectedRevisedAt) => ({ ...unreadableCase, expectedRevisedAt }))
    ))

    it.each(defaultCases)(
      'answers disconnect_tokens_unreadable over $label with expectedRevisedAt $expectedRevisedAt, changing nothing',
      async ({ prepare, expectedRevisedAt }) => {
        const owner = createOwner()
        await connectOwner(owner)
        const deps = await prepare(owner)
        const before = await readRawRows(owner)
        const logsBefore = await readLogs(owner)
        reportError.mockClear()

        await expectGrantError(disconnect(owner, { deps, options: { expectedRevisedAt } }), 'disconnect_tokens_unreadable')

        expect(await readRawRows(owner)).toEqual(before)
        expect(await readLogs(owner)).toEqual(logsBefore)
        expect(revokeRequests()).toEqual([])
        expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE])
      },
      CASE_TIMEOUT_MS,
    )

    it.each(unreadableCases)('erases $label with force, without a revision check, and logs undecryptable', async ({ prepare }) => {
      const owner = createOwner()
      await connectOwner(owner)
      const deps = await prepare(owner)
      reportError.mockClear()

      const result = expectErased(await disconnect(owner, {
        deps,
        options: { expectedRevisedAt: STALE_REVISION, force: true, actorUserId: ACTOR_USER_ID },
      }))

      expect(result).toMatchObject({ revocation: 'failed', failureReason: 'undecryptable' })
      expect((await readRawRows(owner)).map((row) => row.deleted_at === null)).toEqual([false])
      expect(await readDisconnectLogs(owner)).toEqual([
        { code: DISCONNECTED, level: 'info', payload: { disconnectId: result.disconnectId, actorUserId: ACTOR_USER_ID } },
        { code: REVOCATION_PENDING, level: 'warn', payload: { disconnectId: result.disconnectId } },
        {
          code: REVOCATION_FAILED,
          level: 'error',
          payload: { disconnectId: result.disconnectId, failureReason: 'undecryptable' },
        },
      ])
      expect(revokeRequests()).toEqual([])
      expect(reportedCodes()).toEqual([REVOCATION_FAILED])
    }, CASE_TIMEOUT_MS)

    it('erases with force and no DEK through an id-only lookup, with no KMS call after the failed resolution', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const noDekKms = createTestKms({ behavior: 'no_dek' })
      mockReadCredentialRowLayered.mockClear()
      mockWithAdvisoryXactLock.mockClear()

      const result = expectErased(await disconnect(owner, { deps: { kms: noDekKms }, options: { force: true } }))

      expect(result).toMatchObject({ revocation: 'failed', failureReason: 'undecryptable' })
      expect(noDekKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1 })
      expect(mockReadCredentialRowLayered).not.toHaveBeenCalled()
      expect(mockWithAdvisoryXactLock).toHaveBeenCalledTimes(1)
      expect(await readTombstoneCredentials(owner)).toEqual({})
    }, CASE_TIMEOUT_MS)
  })

  describe('Grant Revision and the Grant Lock (A26)', () => {
    it('answers a stale expectedRevisedAt with the standard 409, with or without force, and writes nothing', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const before = await readRawRows(owner)
      const stale = new Date(grant.revisedAt.getTime() - 1000)

      for (const force of [false, true]) {
        const error = await outcomeOf(disconnect(owner, { options: { expectedRevisedAt: stale.toISOString(), force } }))

        expect(isCrudHttpError(error)).toBe(true)
        expect((error as CrudHttpError).status).toBe(409)
        expect((error as CrudHttpError).body).toEqual({
          error: 'record_modified',
          code: 'optimistic_lock_conflict',
          currentUpdatedAt: grant.revisedAt.toISOString(),
          expectedUpdatedAt: stale.toISOString(),
        })
      }
      expect(await readRawRows(owner)).toEqual(before)
      expect(await readDisconnectLogs(owner)).toEqual([])
      expect(revokeRequests()).toEqual([])
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('accepts the current revision as a Date', async () => {
      const owner = createOwner()
      const { result: connected } = await connectOwner(owner)

      expect(await disconnect(owner, { options: { expectedRevisedAt: connected.revisedAt } })).toMatchObject({
        erased: true,
        revocation: 'confirmed',
      })
    }, CASE_TIMEOUT_MS)

    it('answers transient with the grant unchanged when the Grant Lock stays held past the 5 s deadline', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const before = await readRawRows(owner)
      const requestedDeadlines: Array<number | undefined> = []
      mockWithAdvisoryXactLock.mockImplementation((em, key, fn, options) => {
        requestedDeadlines.push(options?.waitDeadlineMs)
        return actualLock.withAdvisoryXactLock(em, key, fn, { ...options, waitDeadlineMs: 300 })
      })
      const held = await holdGrantLock(owner)
      try {
        await expectGrantError(disconnect(owner), 'transient')
      } finally {
        await held.release()
      }

      expect(requestedDeadlines).toEqual([5_000])
      expect(await readRawRows(owner)).toEqual(before)
      expect(await readDisconnectLogs(owner)).toEqual([])
      expect(revokeRequests()).toEqual([])
      expect(reportedCodes()).toEqual([WRITE_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('answers transient and rolls the erase back when a transient database error hits the lock section', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const before = await readRawRows(owner)
      failing.grantUpdates = true

      await expectGrantError(disconnect(owner), 'transient')

      failing.grantUpdates = false
      expect(await readRawRows(owner)).toEqual(before)
      expect(await readDisconnectLogs(owner)).toEqual([])
      expect(revokeRequests()).toEqual([])
      expect(reportedCodes()).toEqual([WRITE_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('still revokes and answers erased when the commit outcome is unknown but the erase committed', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      mockWithAdvisoryXactLock.mockImplementationOnce(async (em, key, fn, options) => {
        await actualLock.withAdvisoryXactLock(em, key, fn, options)
        throw new AdvisoryLockUnavailableError('commit_unknown', key, simulatedLockTimeout())
      })

      const result = expectErased(await disconnect(owner, { options: { actorUserId: ACTOR_USER_ID } }))

      expect(result).toEqual({ erased: true, disconnectId: result.disconnectId, revocation: 'confirmed', failureReason: null })
      expect((await readRawRows(owner)).map((row) => row.deleted_at === null)).toEqual([false])
      expect(await readTombstoneCredentials(owner)).toEqual({})
      expect(revokeRequests()).toEqual([{ token: grant.refreshToken, token_type_hint: 'refresh_token' }])
      expect(server().counters().revoke).toBe(1)
      expect(await readDisconnectLogs(owner)).toEqual([
        { code: DISCONNECTED, level: 'info', payload: { disconnectId: result.disconnectId, actorUserId: ACTOR_USER_ID } },
        { code: REVOCATION_PENDING, level: 'warn', payload: { disconnectId: result.disconnectId } },
        { code: REVOCATION_CONFIRMED, level: 'info', payload: { disconnectId: result.disconnectId } },
      ])
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBeNull()
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('answers transient with the grant live when the commit outcome is unknown and the erase did not commit', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const before = await readRawRows(owner)
      const rolledBack = new Error('[internal] simulated failed commit')
      mockWithAdvisoryXactLock.mockImplementationOnce(async (em, key, fn, options) => {
        await actualLock.withAdvisoryXactLock(em, key, async (txEm) => {
          await fn(txEm)
          throw rolledBack
        }, options).catch((error: unknown) => {
          if (error !== rolledBack) throw error
        })
        throw new AdvisoryLockUnavailableError('commit_unknown', key, simulatedLockTimeout())
      })

      await expectGrantError(disconnect(owner), 'transient')

      expect(await readRawRows(owner)).toEqual(before)
      expect(await readDisconnectLogs(owner)).toEqual([])
      expect(server().counters().revoke).toBe(0)
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBe('active')
      expect(reportedCodes()).toEqual([WRITE_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('rejects a malformed descriptor, a disconnect hook or malformed options before any read, lock or KMS call', async () => {
      const owner = createOwner()
      const kms = countingKms(activeKms)
      const service = createService({ kms })

      await expectDescriptorError(
        service.disconnect(descriptorOf({ ...owner, integrationId: 'another_integration' }), owner, { expectedRevisedAt: null }),
        'integrationId',
      )
      await expectDescriptorError(
        service.disconnect(
          { ...descriptorOf(owner), onAfterDisconnect: async () => undefined } as OAuthProviderDescriptor,
          owner,
          { expectedRevisedAt: null },
        ),
        'onAfterDisconnect',
      )
      await expectDescriptorError(
        service.disconnect(descriptorOf(owner), owner, {} as unknown as DisconnectOptions),
        'options.expectedRevisedAt',
      )
      await expectDescriptorError(
        service.disconnect(descriptorOf(owner), owner, { expectedRevisedAt: null, force: 'yes' } as unknown as DisconnectOptions),
        'options.force',
      )

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(mockReadCredentialRowLayered).not.toHaveBeenCalled()
      expect(kms.calls).toEqual({ getTenantDek: 0, createTenantDek: 0 })
    }, CASE_TIMEOUT_MS)
  })

  describe('DEK pin (A23, disconnect)', () => {
    it('answers disconnect_tokens_unreadable with no DEK before any Grant Lock attempt and calls no KMS after the failed resolution', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      const before = await readRawRows(owner)
      const noDekKms = createTestKms({ behavior: 'no_dek' })
      mockWithAdvisoryXactLock.mockClear()

      await expectGrantError(disconnect(owner, { deps: { kms: noDekKms } }), 'disconnect_tokens_unreadable')

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(noDekKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1 })
      expect(await readRawRows(owner)).toEqual(before)
      expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE])
    }, CASE_TIMEOUT_MS)

    it('resolves the DEK once while it backs off several times behind a held Grant Lock', async () => {
      const owner = createOwner()
      await connectOwner(owner)
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

      const disconnecting = disconnect(owner, { deps: { kms: pinKms } })
      try {
        await waitFor(() => waits >= 3, 'three back-offs behind the held lock')
      } finally {
        await held.release()
      }
      const result = await disconnecting

      expect(result).toMatchObject({ erased: true, revocation: 'confirmed' })
      expect(pinKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 0 })
    }, CASE_TIMEOUT_MS)
  })

  describe('revocation (A31)', () => {
    it('revokes the stored access token when the grant holds no refresh token', async () => {
      const owner = createOwner()
      await configureClient(owner)
      server().inject({ endpoint: 'token', grantType: 'authorization_code', omitRefreshToken: true })
      const tokens = await obtainTokens()
      await createService().completeConnect(descriptorOf(owner, { requiresRefreshToken: false }), owner, tokens, {
        clientId: server().clientId,
      })

      const result = expectErased(await disconnect(owner))

      expect(result).toMatchObject({ revocation: 'confirmed', failureReason: null })
      expect(revokeRequests()).toEqual([{ token: tokens.accessToken, token_type_hint: 'access_token' }])
    }, CASE_TIMEOUT_MS)

    it('records the provider error code when the revoke is rejected', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      server().inject({ endpoint: 'revoke', status: 400, body: { error: 'invalid_request' } })

      const result = expectErased(await disconnect(owner))

      expect(result).toMatchObject({ revocation: 'failed', failureReason: 'invalid_request' })
      expect(revokeRequests()).toHaveLength(1)
      expect((await readDisconnectLogs(owner)).at(-1)).toEqual({
        code: REVOCATION_FAILED,
        level: 'error',
        payload: { disconnectId: result.disconnectId, failureReason: 'invalid_request' },
      })
    }, CASE_TIMEOUT_MS)

    it('logs oauth_revocation_unsupported without a revocation endpoint', async () => {
      const owner = createOwner()
      await connectOwner(owner)

      const result = expectErased(await disconnect(owner, { descriptor: { revocationEndpoint: undefined } }))

      expect(result).toMatchObject({ revocation: 'unsupported', failureReason: null })
      expect(revokeRequests()).toEqual([])
      expect((await readDisconnectLogs(owner)).at(-1)).toEqual({
        code: REVOCATION_UNSUPPORTED,
        level: 'info',
        payload: { disconnectId: result.disconnectId },
      })
    }, CASE_TIMEOUT_MS)

    it('skips the revoke for an invalidated grant', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const invalidated = await writeStoredGrant(owner, {
        ...grant,
        status: 'invalidated',
        invalidatedReason: 'grant_rejected',
        invalidatedAt: new Date(),
      })

      const result = expectErased(await disconnect(owner, { options: { expectedRevisedAt: invalidated.revisedAt } }))

      expect(result).toMatchObject({ revocation: 'skipped_invalidated', failureReason: null })
      expect(revokeRequests()).toEqual([])
      expect((await readDisconnectLogs(owner)).at(-1)).toEqual({
        code: REVOCATION_SKIPPED_INVALIDATED,
        level: 'info',
        payload: { disconnectId: result.disconnectId },
      })
    }, CASE_TIMEOUT_MS)

    it('records client_not_configured without a revoke when the Client Configuration is gone', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await eraseIntegrationCredentials(fork(), INTEGRATION_ID, scopeOf(owner))

      const result = expectErased(await disconnect(owner))

      expect(result).toMatchObject({ revocation: 'failed', failureReason: 'client_not_configured' })
      expect(revokeRequests()).toEqual([])
    }, CASE_TIMEOUT_MS)
  })

  describe('serialized lifecycle and owner isolation (A32, A33)', () => {
    it('leaves one live row and one tombstone after disconnect → connect → refresh, and the refresh uses the new row', async () => {
      const owner = createOwner()
      const { grant: first } = await connectOwner(owner)
      expectErased(await disconnect(owner))
      const second = await connectWith(owner, await obtainTokens())
      const secondGrant = await readStoredGrant(owner)

      const token = await createService().getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })

      expect(second.reconnect).toBe(false)
      expect(secondGrant.refreshToken).not.toBe(first.refreshToken)
      const refreshRequests = server().requests().filter((request) => request.params.grant_type === 'refresh_token')
      expect(refreshRequests.at(-1)?.params.refresh_token).toBe(secondGrant.refreshToken)
      expect(token.accessToken).toBe((await readStoredGrant(owner)).accessToken)
      const rows = await readRawRows(owner)
      expect(rows.map((row) => row.deleted_at === null)).toEqual([false, true])
      expect(new Set(rows.map((row) => row.id)).size).toBe(2)
    }, CASE_TIMEOUT_MS)

    it('refreshes and disconnects owners that differ only by organization, tenant or integrationId independently', async () => {
      const base = createOwner()
      const owners = [
        base,
        { ...base, organizationId: randomUUID() },
        { ...base, tenantId: randomUUID() },
        { ...base, integrationId: SECOND_INTEGRATION_ID },
      ]
      for (const owner of owners) await connectOwner(owner)
      const [, otherOrganization, otherTenant, otherIntegration] = owners
      const othersBefore = await Promise.all([otherOrganization, otherTenant, otherIntegration].map((owner) => readStoredGrant(owner)))

      await createService().getAccessToken(descriptorOf(base), base, { forceRefresh: true })
      const baseGrant = await readStoredGrant(base)
      expect(await Promise.all([otherOrganization, otherTenant, otherIntegration].map((owner) => readStoredGrant(owner)))).toEqual(othersBefore)

      expectErased(await disconnect(base))

      expect(revokeRequests()).toEqual([{ token: baseGrant.refreshToken, token_type_hint: 'refresh_token' }])
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(base))).toBeNull()
      for (const [index, owner] of [otherOrganization, otherTenant, otherIntegration].entries()) {
        expect(await createService().readGrantStatus(owner.integrationId, scopeOf(owner))).toBe('active')
        expect(await readStoredGrant(owner)).toEqual(othersBefore[index])
        const token = await createService().getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })
        expect(token.accessToken).not.toBe(othersBefore[index]?.accessToken)
      }

      expectErased(await disconnect(otherIntegration))
      expect(await createService().readGrantStatus(SECOND_INTEGRATION_ID, scopeOf(otherIntegration))).toBeNull()
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(otherOrganization))).toBe('active')
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(otherTenant))).toBe('active')
    }, CASE_TIMEOUT_MS)
  })

  describe('encryption disabled (A39)', () => {
    it('connects, refreshes, updates provider data, inspects and disconnects with no KMS call, on a plaintext row', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'no'
      const kms = createTestKms()
      harness().setKms(kms)
      activeKms = kms
      const owner = createOwner()
      await configureClient(owner)
      const tokens = await obtainTokens()

      const connected = await createService({ kms }).completeConnect(descriptorOf(owner), owner, tokens, { clientId: server().clientId })
      const [grantRow] = await readRawRows(owner)
      const [clientRow] = await readRawRows(owner, INTEGRATION_ID)
      expect(parseRawCredentials(clientRow)).toEqual({ clientId: server().clientId, clientSecret: server().clientSecret })
      expect(parseRawCredentials(grantRow)).toMatchObject({ status: 'active', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })
      expect(parseRawCredentials(grantRow)).not.toHaveProperty(ENVELOPE_KEY)

      const token = await createService({ kms }).getAccessToken(descriptorOf(owner), owner, { forceRefresh: true })
      expect(token.accessToken).not.toBe(tokens.accessToken)
      expect(parseRawCredentials((await readRawRows(owner))[0])).toMatchObject({ accessToken: token.accessToken, refreshCount: 1 })

      const updated = await createService({ kms }).updateProviderData(descriptorOf(owner), owner, { externalAccountId: 'acct-1' }, {
        expectedRevisedAt: connected.revisedAt,
      })
      const inspection = await createService({ kms }).inspectGrant(descriptorOf(owner), owner)
      expect(inspection).toMatchObject({
        status: 'active',
        connectionState: 'active',
        providerData: { externalAccountId: 'acct-1' },
        revisedAt: updated.revisedAt,
      })

      const result = await createService({ kms }).disconnect(descriptorOf(owner), owner, { expectedRevisedAt: updated.revisedAt })

      expect(result).toMatchObject({ erased: true, revocation: 'confirmed', failureReason: null })
      const rows = await readRawRows(owner)
      expect(rows.map((row) => row.deleted_at === null)).toEqual([false])
      expect(parseRawCredentials(rows[0])).toEqual({})
      expect(kms.calls).toEqual({ getTenantDek: 0, createTenantDek: 0 })
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    type SealedCase = { label: string; seal: (owner: OAuthGrantOwner) => Promise<void> }
    const sealedCases: SealedCase[] = [
      {
        label: 'an envelope sealed while encryption was on',
        seal: async (owner) => {
          await writeRawGrant(owner, { [ENVELOPE_KEY]: 'sealed-before-encryption-was-switched-off' })
        },
      },
      {
        label: 'field-level ciphertext written while encryption was on',
        seal: async (owner) => {
          await connectOwner(owner, { configure: false })
        },
      },
    ]

    it.each(sealedCases)('reads $label as unreadable and replaces it only through a forced Disconnect and a Connect', async ({ seal }) => {
      const owner = createOwner()
      await configureClient(owner)
      await seal(owner)
      process.env.TENANT_DATA_ENCRYPTION = 'no'
      const before = await readRawRows(owner)
      reportError.mockClear()

      await expectGrantError(createService().getAccessToken(descriptorOf(owner), owner), 'platform_unavailable')
      expect(await createService().inspectGrant(descriptorOf(owner), owner)).toMatchObject({
        status: 'unavailable',
        connectionState: 'unavailable',
        unavailableReason: 'platform',
      })
      await expectGrantError(disconnect(owner), 'disconnect_tokens_unreadable')
      expect(await readRawRows(owner)).toEqual(before)

      const forced = expectErased(await disconnect(owner, { options: { force: true } }))
      expect(forced).toMatchObject({ revocation: 'failed', failureReason: 'undecryptable' })

      const tokens = await obtainTokens()
      const reconnected = await connectWith(owner, tokens)
      expect(reconnected).toMatchObject({ reconnect: false, replacedUnreadable: false })
      const rows = await readRawRows(owner)
      expect(rows.map((row) => row.deleted_at === null)).toEqual([false, true])
      expect(parseRawCredentials(rows[1])).toMatchObject({ status: 'active', accessToken: tokens.accessToken })
      expect(parseRawCredentials(rows[1])).not.toHaveProperty(ENVELOPE_KEY)
      expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE, PLATFORM_UNAVAILABLE, REVOCATION_FAILED])
    }, CASE_TIMEOUT_MS)
  })
})
