import { randomUUID } from 'node:crypto'
import type { EventSubscriber } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { IntegrationLog } from '../../../data/entities'
import { createTestKms, startPgTestOrm, type PgTestOrm, type TestKms } from '../../../__tests__/support/pgTestOrm'
import { createCredentialsService, readCredentialRowLayered } from '../../credentials-service'
import { exchangeAuthorizationCode } from '../authorization'
import { OAuthGrantError, type OAuthGrantOwner, type OAuthProviderDescriptor } from '../descriptor'
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
} from '../grant-service'
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

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 20_000
const INTEGRATION_ID = 'test_oauth_grant'
const GRANT_ROW_ID = oauthGrantRowId(INTEGRATION_ID)
const CREDENTIALS_ENTITY_ID = 'integrations:integration_credentials'
const ENVELOPE_KEY = '__om_encrypted_credentials_blob_v1'
const DEFAULT_SCOPES = ['test.read', 'test.write']
const REDIRECT_URI = 'http://127.0.0.1/callback'
const ACTOR_USER_ID = '99999999-9999-4999-8999-999999999999'
const CONNECTED = 'integrations.oauth_connected'
const CONNECT_PERSIST_FAILED = 'integrations.oauth_connect_persist_failed'

const mockWithAdvisoryXactLock = withAdvisoryXactLock as jest.MockedFunction<typeof withAdvisoryXactLock>

type RawGrantRow = { id: string; credentials: string; updated_at: string; deleted_at: string | null }
type LogRow = { code: string; level: string; payload: Record<string, unknown> | null }
type MapRow = { id: string; is_active: boolean; updated_at: string }
type ConnectOverrides = {
  tokens?: OAuthTokenEndpointResponse
  descriptor?: Partial<OAuthProviderDescriptor>
  options?: { clientId?: string; requestedScopes?: string[]; replaceUnreadable?: boolean }
  deps?: Partial<IntegrationOAuthGrantServiceDeps>
}

function createOwner(): OAuthGrantOwner {
  return { integrationId: INTEGRATION_ID, tenantId: randomUUID(), organizationId: randomUUID() }
}

function scopeOf(owner: OAuthGrantOwner) {
  return { tenantId: owner.tenantId, organizationId: owner.organizationId }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function simulatedLockTimeout(): Error {
  return Object.assign(new Error('[internal] simulated lock timeout'), { code: '55P03' })
}

function countingKms(target: KmsService): KmsService & { calls: { getTenantDek: number; createTenantDek: number } } {
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

async function expectGrantError(promise: Promise<unknown>, code: string): Promise<OAuthGrantError> {
  const error = await promise.then(
    () => null,
    (failure: unknown) => failure,
  )
  expect(error).toBeInstanceOf(OAuthGrantError)
  expect((error as OAuthGrantError).code).toBe(code)
  return error as OAuthGrantError
}

describeWithPostgres('integrationOAuthGrantService.completeConnect against real PostgreSQL', () => {
  let pg: PgTestOrm | null = null
  let fake: FakeAuthorizationServer | null = null
  let activeKms: TestKms = createTestKms()
  let unregisterTelemetry: (() => void) | null = null
  const reportError = jest.fn<void, Parameters<TelemetryRuntime['reportError']>>()
  const failingLogWrites: { code: string | null } = { code: null }

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

  function descriptorFor(overrides: Partial<OAuthProviderDescriptor> = {}): OAuthProviderDescriptor {
    const authorizationServer = server()
    return {
      integrationId: INTEGRATION_ID,
      authorizationEndpoint: authorizationServer.authorizationEndpoint,
      tokenEndpoint: authorizationServer.tokenEndpoint,
      ...(authorizationServer.revocationEndpoint ? { revocationEndpoint: authorizationServer.revocationEndpoint } : {}),
      defaultScopes: DEFAULT_SCOPES,
      ...overrides,
    }
  }

  async function obtainTokens(input: { scope?: string[]; omitRefreshToken?: boolean } = {}): Promise<OAuthTokenEndpointResponse> {
    const authorizationServer = server()
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
      descriptorFor(),
      { clientId: authorizationServer.clientId, clientSecret: authorizationServer.clientSecret },
      { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier },
    )
  }

  function createService(deps: Partial<IntegrationOAuthGrantServiceDeps> = {}): IntegrationOAuthGrantService {
    return createIntegrationOAuthGrantService({ em: fork(), ...deps })
  }

  async function connect(owner: OAuthGrantOwner, overrides: ConnectOverrides = {}) {
    const tokens = overrides.tokens ?? await obtainTokens()
    return createService(overrides.deps).completeConnect(descriptorFor(overrides.descriptor), owner, tokens, {
      clientId: overrides.options?.clientId ?? server().clientId,
      requestedScopes: overrides.options?.requestedScopes,
      replaceUnreadable: overrides.options?.replaceUnreadable,
      actorUserId: ACTOR_USER_ID,
    })
  }

  async function readGrant(owner: OAuthGrantOwner, kms: KmsService = activeKms) {
    return readCredentialRowLayered(fork(), GRANT_ROW_ID, scopeOf(owner), { kms, validate: parseOAuthGrantBlob })
  }

  async function readStoredGrant(owner: OAuthGrantOwner): Promise<OAuthGrantRecord> {
    const read = await readGrant(owner)
    if (read.kind !== 'ok') throw new Error(`[internal] expected a readable grant, got ${read.kind}`)
    return read.value
  }

  async function writeStoredGrant(owner: OAuthGrantOwner, grant: OAuthGrantRecord): Promise<void> {
    await createCredentialsService(fork(), null, { kms: activeKms })
      .save(GRANT_ROW_ID, serializeOAuthGrantBlob(grant), scopeOf(owner))
  }

  async function readRawGrantRows(owner: OAuthGrantOwner): Promise<RawGrantRow[]> {
    return fork().execute<RawGrantRow[]>(
      `select "id", "credentials"::text as "credentials", "updated_at"::text as "updated_at", "deleted_at"
       from "integration_credentials"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by "created_at" asc`,
      [GRANT_ROW_ID, owner.tenantId, owner.organizationId],
    )
  }

  async function readLogs(owner: OAuthGrantOwner, code: string): Promise<LogRow[]> {
    return fork().execute<LogRow[]>(
      `select "code", "level", "payload" from "integration_logs"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ? and "code" = ?
       order by "created_at" asc`,
      [INTEGRATION_ID, owner.tenantId, owner.organizationId, code],
    )
  }

  async function readScopeMapRows(owner: OAuthGrantOwner): Promise<MapRow[]> {
    return fork().execute<MapRow[]>(
      `select "id", "is_active", "updated_at"::text as "updated_at" from "encryption_maps"
       where "entity_id" = ? and "tenant_id" = ? and "organization_id" = ? and "deleted_at" is null`,
      [CREDENTIALS_ENTITY_ID, owner.tenantId, owner.organizationId],
    )
  }

  async function corruptEnvelope(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork(), null, { kms: createTestKms() })
      .save(GRANT_ROW_ID, { corrupted: true }, scopeOf(owner))
  }

  async function writeRawGrant(owner: OAuthGrantOwner, credentials: unknown): Promise<void> {
    await fork().execute(
      `insert into "integration_credentials"
         ("id", "integration_id", "credentials", "organization_id", "tenant_id", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?::jsonb, ?, ?, now(), now())`,
      [GRANT_ROW_ID, JSON.stringify(credentials), owner.organizationId, owner.tenantId],
    )
  }

  function issuedTokens(): string[] {
    const tokens = server().issuedTokens()
    return [...tokens.accessTokens, ...tokens.refreshTokens]
  }

  function expectNoIssuedToken(value: unknown): void {
    const serialized = JSON.stringify(value, (_key, entry: unknown) => (
      entry instanceof Error ? { name: entry.name, message: entry.message, cause: entry.cause } : entry
    ))
    for (const token of issuedTokens()) expect(serialized).not.toContain(token)
  }

  function reportedCodes(): string[] {
    return reportError.mock.calls.map(([, context]) => context?.code ?? '')
  }

  beforeAll(async () => {
    pg = await startPgTestOrm()
    fake = await startFakeAuthorizationServer({ rotation: 'strict' })
    const failingLogSubscriber: EventSubscriber<IntegrationLog> = {
      getSubscribedEntities: () => [IntegrationLog],
      beforeCreate: (args) => {
        if (failingLogWrites.code !== null && args.entity.code === failingLogWrites.code) throw simulatedLockTimeout()
      },
    }
    pg.em.getEventManager().registerSubscriber(failingLogSubscriber)
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
    failingLogWrites.code = null
    reportError.mockClear()
    mockWithAdvisoryXactLock.mockClear()
    server().reset()
    activeKms = createTestKms()
    harness().setKms(activeKms)
  })

  afterAll(async () => {
    unregisterTelemetry?.()
    await fake?.close()
    await pg?.close()
  }, 30_000)

  it('inserts an active grant on a first Connect, sealed at both layers, and logs oauth_connected', async () => {
    const owner = createOwner()

    const result = await connect(owner)

    expect(result).toEqual({ reconnect: false, replacedUnreadable: false, previousProviderData: null, revisedAt: expect.any(Date) })
    const grant = await readStoredGrant(owner)
    const [accessToken] = server().issuedTokens().accessTokens
    const [refreshToken] = server().issuedTokens().refreshTokens
    expect(grant).toMatchObject({
      status: 'active',
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      clientId: server().clientId,
      grantedScopes: DEFAULT_SCOPES,
      refreshedAt: null,
      refreshCount: 0,
      lastFailureClass: null,
      providerData: null,
      previousProviderData: null,
    })
    expect(grant.obtainedAt).toEqual(result.revisedAt)
    expect(grant.revisedAt).toEqual(result.revisedAt)
    expect(grant.expiresAt.getTime() - grant.obtainedAt.getTime()).toBe(3600 * 1000)
    const rows = await readRawGrantRows(owner)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.credentials).not.toContain(ENVELOPE_KEY)
    expectNoIssuedToken(rows)
    const logs = await readLogs(owner, CONNECTED)
    expect(logs).toEqual([{
      code: CONNECTED,
      level: 'info',
      payload: {
        reconnect: false,
        replacedUnreadable: false,
        clientId: server().clientId,
        grantedScopes: DEFAULT_SCOPES,
        actorUserId: ACTOR_USER_ID,
      },
    }])
    expectNoIssuedToken(logs)
    expect(reportError).not.toHaveBeenCalled()
  }, CASE_TIMEOUT_MS)

  it('clamps the access token lifetime to one second and one year', async () => {
    const shortLived = createOwner()
    await connect(shortLived, { tokens: { ...(await obtainTokens()), expiresInSec: 0 } })
    const shortGrant = await readStoredGrant(shortLived)
    expect(shortGrant.expiresAt.getTime() - shortGrant.obtainedAt.getTime()).toBe(1000)

    const longLived = createOwner()
    await connect(longLived, { tokens: { ...(await obtainTokens()), expiresInSec: 1e20 } })
    const longGrant = await readStoredGrant(longLived)
    expect(longGrant.expiresAt.getTime() - longGrant.obtainedAt.getTime()).toBe(31_536_000 * 1000)
    expect(longGrant.status).toBe('active')
    expect(reportError).not.toHaveBeenCalled()
  }, CASE_TIMEOUT_MS)

  it('takes grantedScopes from the response, then requestedScopes, then the configured scopes, then the defaults', async () => {
    const fromResponse = createOwner()
    await connect(fromResponse, { tokens: await obtainTokens({ scope: ['granted.a', 'granted.b'] }), options: { requestedScopes: ['asked'] } })
    expect((await readStoredGrant(fromResponse)).grantedScopes).toEqual(['granted.a', 'granted.b'])

    const fromRequest = createOwner()
    await connect(fromRequest, { options: { requestedScopes: ['asked.a'] } })
    expect((await readStoredGrant(fromRequest)).grantedScopes).toEqual(['asked.a'])

    const fromConfiguration = createOwner()
    await createCredentialsService(fork()).save(
      INTEGRATION_ID,
      { clientId: server().clientId, clientSecret: server().clientSecret, scopes: 'configured.a, configured.b' },
      scopeOf(fromConfiguration),
    )
    await connect(fromConfiguration)
    expect((await readStoredGrant(fromConfiguration)).grantedScopes).toEqual(['configured.a', 'configured.b'])
  }, CASE_TIMEOUT_MS)

  it('fails connect_persist_failed when the scopes fall back to an unreadable Client Configuration', async () => {
    const owner = createOwner()
    await createCredentialsService(fork(), null, { kms: createTestKms() })
      .save(INTEGRATION_ID, { clientId: 'client', clientSecret: 'secret' }, scopeOf(owner))

    await expectGrantError(connect(owner), 'connect_persist_failed')

    expect(await readRawGrantRows(owner)).toEqual([])
    expect(await readLogs(owner, CONNECT_PERSIST_FAILED)).toEqual([
      { code: CONNECT_PERSIST_FAILED, level: 'warn', payload: { failure: 'client_configuration_unreadable' } },
    ])
    expect(reportedCodes()).toEqual(['integrations.oauth_platform_unavailable'])
  }, CASE_TIMEOUT_MS)

  describe('serialized writes (A11)', () => {
    it('leaves one live row after two concurrent first Connects', async () => {
      const owner = createOwner()
      const [firstTokens, secondTokens] = [await obtainTokens(), await obtainTokens()]

      const results = await Promise.all([
        connect(owner, { tokens: firstTokens }),
        connect(owner, { tokens: secondTokens }),
      ])

      expect(results.map((result) => result.reconnect).sort()).toEqual([false, true])
      const rows = await readRawGrantRows(owner)
      expect(rows.filter((row) => row.deleted_at === null)).toHaveLength(1)
      expect([firstTokens.accessToken, secondTokens.accessToken]).toContain((await readStoredGrant(owner)).accessToken)
    }, CASE_TIMEOUT_MS)

    it('updates in place on Reconnect, clears providerData and keeps the last non-empty previousProviderData', async () => {
      const owner = createOwner()
      await connect(owner)
      const [row] = await readRawGrantRows(owner)
      await writeStoredGrant(owner, { ...(await readStoredGrant(owner)), providerData: { externalAccountId: 'acct-1' } })

      const first = await connect(owner)
      expect(first).toMatchObject({ reconnect: true, replacedUnreadable: false, previousProviderData: { externalAccountId: 'acct-1' } })
      expect(await readStoredGrant(owner)).toMatchObject({ providerData: null, previousProviderData: { externalAccountId: 'acct-1' } })

      const second = await connect(owner)
      expect(second.previousProviderData).toEqual({ externalAccountId: 'acct-1' })
      expect(await readStoredGrant(owner)).toMatchObject({ providerData: null, previousProviderData: { externalAccountId: 'acct-1' } })

      await writeStoredGrant(owner, { ...(await readStoredGrant(owner)), providerData: { externalAccountId: 'acct-2' } })
      const third = await connect(owner)
      expect(third.previousProviderData).toEqual({ externalAccountId: 'acct-2' })

      const rows = await readRawGrantRows(owner)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(row?.id)
      expect(await readLogs(owner, CONNECTED)).toHaveLength(4)
    }, CASE_TIMEOUT_MS)

    it('creates one live active map in a scope without one and invalidates it once, after commit', async () => {
      const owner = createOwner()
      const liveGrantRowsSeen: number[] = []
      const invalidateMap = jest.fn(async () => {
        const rows = await fork().execute<Array<{ count: string }>>(
          `select count(*)::text as "count" from "integration_credentials"
           where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ? and "deleted_at" is null`,
          [GRANT_ROW_ID, owner.tenantId, owner.organizationId],
        )
        liveGrantRowsSeen.push(Number(rows[0]?.count ?? 0))
      })
      expect(await readScopeMapRows(owner)).toEqual([])

      await connect(owner, { deps: { encryptionService: { invalidateMap } } })

      const maps = await readScopeMapRows(owner)
      expect(maps).toHaveLength(1)
      expect(maps[0]?.is_active).toBe(true)
      expect(invalidateMap).toHaveBeenCalledTimes(1)
      expect(invalidateMap).toHaveBeenCalledWith(CREDENTIALS_ENTITY_ID, owner.tenantId, owner.organizationId)
      expect(liveGrantRowsSeen).toEqual([1])

      await connect(owner, { deps: { encryptionService: { invalidateMap } } })

      expect(invalidateMap).toHaveBeenCalledTimes(1)
      expect(await readScopeMapRows(owner)).toEqual(maps)
    }, CASE_TIMEOUT_MS)

    it('never invalidates the map after a connect_persist_failed rollback; the persist-failed entry survives', async () => {
      const owner = createOwner()
      const invalidateMap = jest.fn(async () => undefined)
      failingLogWrites.code = CONNECTED

      await expectGrantError(connect(owner, { deps: { encryptionService: { invalidateMap } } }), 'connect_persist_failed')

      expect(invalidateMap).not.toHaveBeenCalled()
      expect(await readRawGrantRows(owner)).toEqual([])
      expect(await readScopeMapRows(owner)).toEqual([])
      expect(await readLogs(owner, CONNECTED)).toEqual([])
      expect(await readLogs(owner, CONNECT_PERSIST_FAILED)).toEqual([
        { code: CONNECT_PERSIST_FAILED, level: 'warn', payload: { failure: 'transient_db' } },
      ])
      expect(reportedCodes()).toEqual(['integrations.oauth_connect_persist_failed'])
      expectNoIssuedToken(reportError.mock.calls)
    }, CASE_TIMEOUT_MS)

    it('keeps the result when the deferred map invalidation throws, and reports it', async () => {
      const owner = createOwner()
      const invalidateMap = jest.fn(async () => {
        throw new Error('[internal] invalidation failed')
      })

      const result = await connect(owner, { deps: { encryptionService: { invalidateMap } } })

      expect(result.reconnect).toBe(false)
      expect(invalidateMap).toHaveBeenCalledTimes(1)
      expect((await readStoredGrant(owner)).status).toBe('active')
      expect(reportedCodes()).toEqual(['integrations.oauth_map_invalidation_failed'])
    }, CASE_TIMEOUT_MS)
  })

  describe('Connect contract (A12)', () => {
    it('fails connect_exchange_failed without a refresh token while the descriptor requires one, writing nothing', async () => {
      const owner = createOwner()

      await expectGrantError(connect(owner, { tokens: await obtainTokens({ omitRefreshToken: true }) }), 'connect_exchange_failed')

      expect(await readRawGrantRows(owner)).toEqual([])
      expect(await readLogs(owner, CONNECTED)).toEqual([])
    }, CASE_TIMEOUT_MS)

    it('keeps the stored refresh token only on a same-client Reconnect over an active grant', async () => {
      const owner = createOwner()
      await connect(owner)
      const stored = await readStoredGrant(owner)

      const tokens = await obtainTokens({ omitRefreshToken: true })
      await connect(owner, { tokens })

      expect(await readStoredGrant(owner)).toMatchObject({ accessToken: tokens.accessToken, refreshToken: stored.refreshToken })
      await expectGrantError(
        connect(owner, { tokens: await obtainTokens({ omitRefreshToken: true }), options: { clientId: 'another-client' } }),
        'connect_exchange_failed',
      )
      expect((await readStoredGrant(owner)).accessToken).toBe(tokens.accessToken)
    }, CASE_TIMEOUT_MS)

    it('fails connect_exchange_failed over an invalidated grant without a refresh token, which stays invalidated (I3)', async () => {
      const owner = createOwner()
      await connect(owner)
      const invalidated: OAuthGrantRecord = {
        ...(await readStoredGrant(owner)),
        status: 'invalidated',
        invalidatedReason: 'grant_rejected',
        invalidatedAt: new Date(),
      }
      await writeStoredGrant(owner, invalidated)

      await expectGrantError(connect(owner, { tokens: await obtainTokens({ omitRefreshToken: true }) }), 'connect_exchange_failed')

      expect(await readStoredGrant(owner)).toEqual(invalidated)
    }, CASE_TIMEOUT_MS)

    it('stores no refresh token when the descriptor does not require one', async () => {
      const owner = createOwner()

      await connect(owner, { tokens: await obtainTokens({ omitRefreshToken: true }), descriptor: { requiresRefreshToken: false } })

      expect((await readStoredGrant(owner)).refreshToken).toBeNull()
    }, CASE_TIMEOUT_MS)

    it('makes no token call when exchangeAuthorizationCode has no verifier', async () => {
      const pkce = createPkcePair()
      const code = server().issueAuthorizationCode({ redirectUri: REDIRECT_URI, codeChallenge: pkce.codeChallenge })

      await expectGrantError(
        exchangeAuthorizationCode(descriptorFor(), { clientId: server().clientId, clientSecret: server().clientSecret }, { code, redirectUri: REDIRECT_URI }),
        'connect_state_invalid',
      )

      expect(server().counters().token.authorizationCode).toBe(0)
    }, CASE_TIMEOUT_MS)

    it('leaves an existing grant untouched on connect_persist_failed and keeps its log entry', async () => {
      const owner = createOwner()
      await connect(owner)
      const before = await readRawGrantRows(owner)
      failingLogWrites.code = CONNECTED

      await expectGrantError(connect(owner), 'connect_persist_failed')

      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, CONNECTED)).toHaveLength(1)
      expect(await readLogs(owner, CONNECT_PERSIST_FAILED)).toHaveLength(1)
    }, CASE_TIMEOUT_MS)
  })

  describe('unreadable grants (A13, A14)', () => {
    const unreadableCases: Array<[string, (owner: OAuthGrantOwner) => Promise<void>]> = [
      ['an envelope sealed with another key', (owner) => corruptEnvelope(owner)],
      ['a blob that decrypts to {}', (owner) => createCredentialsService(fork(), null, { kms: activeKms }).save(GRANT_ROW_ID, {}, scopeOf(owner))],
    ]

    it.each(unreadableCases)('fails connect_grant_unreadable without the flag over %s, changing and revoking nothing', async (_label, makeUnreadable) => {
      const owner = createOwner()
      await connect(owner)
      await makeUnreadable(owner)
      const before = await readRawGrantRows(owner)
      const revokesBefore = server().counters().revoke

      await expectGrantError(connect(owner), 'connect_grant_unreadable')

      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, CONNECTED)).toHaveLength(1)
      expect(server().counters().revoke).toBe(revokesBefore)
    }, CASE_TIMEOUT_MS)

    it.each(unreadableCases)('overwrites %s in place with replaceUnreadable, like a first Connect', async (_label, makeUnreadable) => {
      const owner = createOwner()
      await connect(owner)
      await writeStoredGrant(owner, { ...(await readStoredGrant(owner)), providerData: { externalAccountId: 'acct-1' } })
      await makeUnreadable(owner)
      const [row] = await readRawGrantRows(owner)
      const tokens = await obtainTokens({ omitRefreshToken: true })

      const result = await connect(owner, {
        tokens,
        descriptor: { requiresRefreshToken: false },
        options: { replaceUnreadable: true },
      })

      expect(result).toMatchObject({ reconnect: true, replacedUnreadable: true, previousProviderData: null })
      const rows = await readRawGrantRows(owner)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(row?.id)
      expect(await readStoredGrant(owner)).toMatchObject({
        status: 'active',
        accessToken: tokens.accessToken,
        refreshToken: null,
        providerData: null,
        previousProviderData: null,
      })
      const logs = await readLogs(owner, CONNECTED)
      expect(logs[logs.length - 1]?.payload).toMatchObject({ reconnect: true, replacedUnreadable: true })
    }, CASE_TIMEOUT_MS)
  })

  describe('no overwrite without a readable layer (A15)', () => {
    type LayerCase = {
      label: string
      prepare: (owner: OAuthGrantOwner) => Promise<Partial<IntegrationOAuthGrantServiceDeps>>
      failure: string
    }
    const layerCases: LayerCase[] = [
      {
        label: 'field-level ciphertext the layer cannot open',
        failure: 'field_ciphertext',
        prepare: async (owner) => {
          await connect(owner)
          const grantKms = activeKms
          harness().setKms(createTestKms({ behavior: 'no_dek' }))
          return { kms: grantKms }
        },
      },
      {
        label: 'a failed DEK pin',
        failure: 'no_dek',
        prepare: async (owner) => {
          await connect(owner)
          return { kms: createTestKms({ behavior: 'no_dek' }) }
        },
      },
      {
        label: 'an envelope sealed while encryption was on, read with encryption off',
        failure: 'no_dek',
        prepare: async (owner) => {
          await writeRawGrant(owner, { [ENVELOPE_KEY]: 'sealed-before-encryption-was-switched-off' })
          process.env.TENANT_DATA_ENCRYPTION = 'no'
          return {}
        },
      },
    ]
    const flagCases = layerCases.flatMap((layerCase) => [false, true].map((replaceUnreadable) => ({ ...layerCase, replaceUnreadable })))

    it.each(flagCases)('fails connect_persist_failed over $label (replaceUnreadable: $replaceUnreadable)', async ({ prepare, failure, replaceUnreadable }) => {
      const owner = createOwner()
      const deps = await prepare(owner)
      const before = await readRawGrantRows(owner)
      const connectedBefore = (await readLogs(owner, CONNECTED)).length
      reportError.mockClear()

      await expectGrantError(connect(owner, { deps, options: { replaceUnreadable } }), 'connect_persist_failed')

      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, CONNECTED)).toHaveLength(connectedBefore)
      expect(await readLogs(owner, CONNECT_PERSIST_FAILED)).toEqual([
        { code: CONNECT_PERSIST_FAILED, level: 'warn', payload: { failure } },
      ])
      expect(reportedCodes()).toEqual(['integrations.oauth_platform_unavailable'])
    }, CASE_TIMEOUT_MS)
  })

  describe('DEK pin (A23, connect)', () => {
    it('returns connect_persist_failed before any advisory lock attempt and calls no KMS after the failed resolution', async () => {
      const owner = createOwner()
      const noDekKms = createTestKms({ behavior: 'no_dek' })

      await expectGrantError(connect(owner, { deps: { kms: noDekKms } }), 'connect_persist_failed')

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(noDekKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1 })
      expect(await readRawGrantRows(owner)).toEqual([])
    }, CASE_TIMEOUT_MS)

    it('resolves the DEK once while it backs off behind a held Grant Lock', async () => {
      const owner = createOwner()
      await activeKms.createTenantDek(owner.tenantId)
      const pinKms = countingKms(activeKms)
      const tokens = await obtainTokens()
      let releaseLock: () => void = () => undefined
      const lockReleased = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      let markLockHeld: () => void = () => undefined
      const lockHeld = new Promise<void>((resolve) => {
        markLockHeld = resolve
      })
      const holder = fork().transactional(async (tx) => {
        await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [oauthGrantLockKey(owner)])
        markLockHeld()
        await lockReleased
      })
      await lockHeld

      const startedAt = Date.now()
      const connecting = connect(owner, { tokens, deps: { kms: pinKms } })
      await sleep(700)
      expect(await readRawGrantRows(owner)).toEqual([])
      releaseLock()
      await holder
      const result = await connecting

      expect(result.reconnect).toBe(false)
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700)
      expect(pinKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 0 })
      expect(mockWithAdvisoryXactLock).toHaveBeenCalledTimes(1)
      expect((await readStoredGrant(owner)).accessToken).toBe(tokens.accessToken)
    }, CASE_TIMEOUT_MS)
  })
})
