import { randomUUID } from 'node:crypto'
import type { EventSubscriber } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError, type CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { IntegrationCredentials } from '../../../data/entities'
import { createTestKms, startPgTestOrm, type PgTestOrm, type TestKms } from '../../../__tests__/support/pgTestOrm'
import {
  createCredentialsService,
  eraseIntegrationCredentials,
  readCredentialRowLayered,
} from '../../credentials-service'
import { findLatestIntegrationLogsByCodes } from '../../log-service'
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

jest.mock('../../log-service', () => {
  const actual = jest.requireActual<typeof import('../../log-service')>('../../log-service')
  return { ...actual, findLatestIntegrationLogsByCodes: jest.fn(actual.findLatestIntegrationLogsByCodes) }
})

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 20_000
const INTEGRATION_ID = 'test_oauth_grant'
const GRANT_ROW_ID = oauthGrantRowId(INTEGRATION_ID)
const CREDENTIALS_ENTITY_ID = 'integrations:integration_credentials'
const DEFAULT_SCOPES = ['test.read', 'test.write']
const REDIRECT_URI = 'http://127.0.0.1/callback'
const ACTOR_USER_ID = '99999999-9999-4999-8999-999999999999'
const EXTERNAL_ACCOUNT_SELECTED = 'integrations.oauth_external_account_selected'
const DISCONNECTED = 'integrations.oauth_disconnected'
const REVOCATION_PENDING = 'integrations.oauth_revocation_pending'
const PLATFORM_UNAVAILABLE = 'integrations.oauth_platform_unavailable'
const WRITE_TRANSIENT = 'integrations.oauth_write_transient'
const INSPECT_FAILED = 'integrations.oauth_inspect_failed'
const STALE_REVISION = '2000-01-01T00:00:00.000Z'
const ENV_KEYS = ['NODE_ENV', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'OM_ENABLE_TEST_OAUTH_GRANTS', 'OM_OPTIMISTIC_LOCK'] as const

const actualLock = jest.requireActual<typeof import('@open-mercato/shared/lib/db/advisoryLock')>(
  '@open-mercato/shared/lib/db/advisoryLock',
)
const actualCredentials = jest.requireActual<typeof import('../../credentials-service')>('../../credentials-service')
const actualLogs = jest.requireActual<typeof import('../../log-service')>('../../log-service')
const mockWithAdvisoryXactLock = withAdvisoryXactLock as jest.MockedFunction<typeof withAdvisoryXactLock>
const mockReadCredentialRowLayered = readCredentialRowLayered as jest.MockedFunction<typeof readCredentialRowLayered>
const mockFindLatestIntegrationLogsByCodes = findLatestIntegrationLogsByCodes as jest.MockedFunction<
  typeof findLatestIntegrationLogsByCodes
>

type ProviderDataOptions = Parameters<IntegrationOAuthGrantService['updateProviderData']>[3]
type RawGrantRow = { id: string; credentials: string; updated_at: string; deleted_at: string | null }
type LogRow = { code: string; level: string; payload: Record<string, unknown> | null }
type MapRow = { id: string; is_active: boolean; updated_at: string }
type Gate = { promise: Promise<void>; open(): void }
type HeldLock = { release(): Promise<void> }
type CountingKms = KmsService & { calls: { getTenantDek: number; createTenantDek: number } }
type ConnectedOwner = { result: OAuthConnectResult; grant: OAuthGrantRecord }

function createOwner(): OAuthGrantOwner {
  return { integrationId: INTEGRATION_ID, tenantId: randomUUID(), organizationId: randomUUID() }
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

describeWithPostgres('integrationOAuthGrantService provider data and reads against real PostgreSQL', () => {
  let pg: PgTestOrm | null = null
  let fake: FakeAuthorizationServer | null = null
  let activeKms: TestKms = createTestKms()
  let unregisterTelemetry: (() => void) | null = null
  const reportError = jest.fn<void, Parameters<TelemetryRuntime['reportError']>>()
  const failing = { grantUpdates: false }
  const savedEnv = new Map<string, string | undefined>()

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

  function updateProviderData(
    owner: OAuthGrantOwner,
    data: Record<string, unknown>,
    options: ProviderDataOptions,
    deps: Partial<IntegrationOAuthGrantServiceDeps> = {},
  ): Promise<{ revisedAt: Date }> {
    return createService(deps).updateProviderData(descriptorOf(owner), owner, data, options)
  }

  async function configureClient(
    owner: OAuthGrantOwner,
    overrides: { clientId?: string; clientSecret?: string; scopes?: string } = {},
  ): Promise<void> {
    await createCredentialsService(fork()).save(
      owner.integrationId,
      {
        clientId: overrides.clientId ?? server().clientId,
        clientSecret: overrides.clientSecret ?? server().clientSecret,
        ...(overrides.scopes === undefined ? {} : { scopes: overrides.scopes }),
      },
      scopeOf(owner),
    )
  }

  async function obtainTokens(scope?: string[]): Promise<OAuthTokenEndpointResponse> {
    const pkce = createPkcePair()
    const code = server().issueAuthorizationCode({ redirectUri: REDIRECT_URI, scope, codeChallenge: pkce.codeChallenge })
    return exchangeAuthorizationCode(
      descriptorOf(createOwner()),
      { clientId: server().clientId, clientSecret: server().clientSecret },
      { code, redirectUri: REDIRECT_URI, codeVerifier: pkce.codeVerifier },
    )
  }

  async function readStoredGrant(owner: OAuthGrantOwner): Promise<OAuthGrantRecord> {
    const read = await actualCredentials.readCredentialRowLayered(fork(), GRANT_ROW_ID, scopeOf(owner), {
      kms: activeKms,
      validate: parseOAuthGrantBlob,
    })
    if (read.kind !== 'ok') throw new Error(`[internal] expected a readable grant, got ${read.kind}`)
    return read.value
  }

  async function writeStoredGrant(owner: OAuthGrantOwner, grant: OAuthGrantRecord): Promise<OAuthGrantRecord> {
    await createCredentialsService(fork(), null, { kms: activeKms })
      .save(GRANT_ROW_ID, serializeOAuthGrantBlob(grant), scopeOf(owner))
    return readStoredGrant(owner)
  }

  async function connectOwner(owner: OAuthGrantOwner, input: { scope?: string[]; configure?: boolean } = {}): Promise<ConnectedOwner> {
    if (input.configure !== false) await configureClient(owner)
    const result = await createService().completeConnect(descriptorOf(owner), owner, await obtainTokens(input.scope), {
      clientId: server().clientId,
    })
    return { result, grant: await readStoredGrant(owner) }
  }

  async function corruptEnvelope(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork(), null, { kms: createTestKms() }).save(GRANT_ROW_ID, { corrupted: true }, scopeOf(owner))
  }

  async function sealEmptyBlob(owner: OAuthGrantOwner): Promise<void> {
    await createCredentialsService(fork(), null, { kms: activeKms }).save(GRANT_ROW_ID, {}, scopeOf(owner))
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

  async function readLogs(owner: OAuthGrantOwner, code?: string): Promise<LogRow[]> {
    return fork().execute<LogRow[]>(
      `select "code", "level", "payload" from "integration_logs"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ? and (?::text is null or "code" = ?)
       order by "created_at" asc`,
      [owner.integrationId, owner.tenantId, owner.organizationId, code ?? null, code ?? null],
    )
  }

  async function readScopeMapRows(owner: OAuthGrantOwner): Promise<MapRow[]> {
    return fork().execute<MapRow[]>(
      `select "id", "is_active", "updated_at"::text as "updated_at" from "encryption_maps"
       where "entity_id" = ? and "tenant_id" = ? and "organization_id" = ? and "deleted_at" is null`,
      [CREDENTIALS_ENTITY_ID, owner.tenantId, owner.organizationId],
    )
  }

  async function insertLog(owner: OAuthGrantOwner, code: string, disconnectId: string, createdAt: Date): Promise<void> {
    await fork().execute(
      `insert into "integration_logs"
         ("id", "integration_id", "level", "message", "code", "payload", "organization_id", "tenant_id", "created_at")
       values (gen_random_uuid(), ?, 'info', ?, ?, ?::jsonb, ?, ?, ?)`,
      [owner.integrationId, code, code, JSON.stringify({ disconnectId }), owner.organizationId, owner.tenantId, createdAt.toISOString()],
    )
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
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
    delete process.env.OM_OPTIMISTIC_LOCK
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

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    failing.grantUpdates = false
    reportError.mockClear()
    mockWithAdvisoryXactLock.mockReset()
    mockWithAdvisoryXactLock.mockImplementation(actualLock.withAdvisoryXactLock)
    mockReadCredentialRowLayered.mockReset()
    mockReadCredentialRowLayered.mockImplementation(actualCredentials.readCredentialRowLayered)
    mockFindLatestIntegrationLogsByCodes.mockReset()
    mockFindLatestIntegrationLogsByCodes.mockImplementation(actualLogs.findLatestIntegrationLogsByCodes)
    server().reset()
    activeKms = createTestKms()
    harness().setKms(activeKms)
  })

  afterEach(() => {
    for (const key of ['NODE_ENV', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'OM_ENABLE_TEST_OAUTH_GRANTS'] as const) {
      const value = savedEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  afterAll(async () => {
    unregisterTelemetry?.()
    await fake?.close()
    await pg?.close()
    const lockMode = savedEnv.get('OM_OPTIMISTIC_LOCK')
    if (lockMode === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = lockMode
  }, 30_000)

  describe('updateProviderData (A26)', () => {
    it('stores the selection, clears previousProviderData, moves the revision and logs only the keys', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const stored = await writeStoredGrant(owner, {
        ...grant,
        revisedAt: new Date(grant.revisedAt.getTime() - 60_000),
        previousProviderData: { externalAccountId: 'acct-0' },
      })
      const [row] = await readRawGrantRows(owner)
      const data = { externalAccountId: 'acct-1', displayName: 'Acme Books' }
      mockWithAdvisoryXactLock.mockClear()

      const result = await updateProviderData(owner, data, {
        expectedRevisedAt: stored.revisedAt.toISOString(),
        actorUserId: ACTOR_USER_ID,
      })

      expect(result.revisedAt.getTime()).toBeGreaterThan(stored.revisedAt.getTime())
      expect(await readStoredGrant(owner)).toEqual({ ...stored, providerData: data, previousProviderData: null, revisedAt: result.revisedAt })
      const rows = await readRawGrantRows(owner)
      expect(rows.map((entry) => entry.id)).toEqual([row?.id])
      expectNoIssuedToken(rows)
      const logs = await readLogs(owner, EXTERNAL_ACCOUNT_SELECTED)
      expect(logs).toEqual([{
        code: EXTERNAL_ACCOUNT_SELECTED,
        level: 'info',
        payload: { providerDataKeys: ['externalAccountId', 'displayName'], actorUserId: ACTOR_USER_ID },
      }])
      expect(JSON.stringify(logs)).not.toContain('acct-1')
      expect(JSON.stringify(logs)).not.toContain('Acme Books')
      expectNoIssuedToken(logs)
      expect(mockWithAdvisoryXactLock).toHaveBeenCalledTimes(1)
      expect(mockWithAdvisoryXactLock).toHaveBeenCalledWith(
        expect.anything(),
        oauthGrantLockKey(owner),
        expect.any(Function),
        expect.objectContaining({ waitDeadlineMs: 15_000, maxConcurrentHolders: 4 }),
      )
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('accepts the expected revision as a Date and skips the comparison for null', async () => {
      const owner = createOwner()
      const { result } = await connectOwner(owner)

      const first = await updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: result.revisedAt })
      const second = await updateProviderData(owner, { externalAccountId: 'acct-2' }, { expectedRevisedAt: null })

      expect(second.revisedAt.getTime()).toBeGreaterThanOrEqual(first.revisedAt.getTime())
      expect(await readStoredGrant(owner)).toMatchObject({ providerData: { externalAccountId: 'acct-2' }, revisedAt: second.revisedAt })
      expect((await readLogs(owner, EXTERNAL_ACCOUNT_SELECTED)).map((log) => log.payload)).toEqual([
        { providerDataKeys: ['externalAccountId'], actorUserId: null },
        { providerDataKeys: ['externalAccountId'], actorUserId: null },
      ])
    }, CASE_TIMEOUT_MS)

    it('answers a stale expectedRevisedAt with the standard 409 conflict body and writes nothing', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const before = await readRawGrantRows(owner)
      const stale = new Date(grant.revisedAt.getTime() - 1000)

      const error = await outcomeOf(updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: stale.toISOString() }))

      expect(isCrudHttpError(error)).toBe(true)
      expect((error as CrudHttpError).status).toBe(409)
      expect((error as CrudHttpError).body).toEqual({
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: grant.revisedAt.toISOString(),
        expectedUpdatedAt: stale.toISOString(),
      })
      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, EXTERNAL_ACCOUNT_SELECTED)).toEqual([])
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

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
    ]

    it.each(unreadableCases)('answers platform_unavailable over $label before any revision comparison', async ({ prepare }) => {
      const owner = createOwner()
      await connectOwner(owner)
      const deps = await prepare(owner)
      const before = await readRawGrantRows(owner)
      reportError.mockClear()

      await expectGrantError(updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: STALE_REVISION }, deps), 'platform_unavailable')

      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, EXTERNAL_ACCOUNT_SELECTED)).toEqual([])
      expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE])
    }, CASE_TIMEOUT_MS)

    it('answers not_connected without a live grant, also after the grant was erased by a Disconnect', async () => {
      const neverConnected = createOwner()
      await configureClient(neverConnected)

      await expectGrantError(updateProviderData(neverConnected, { externalAccountId: 'acct-1' }, { expectedRevisedAt: null }), 'not_connected')
      expect(await readRawGrantRows(neverConnected)).toEqual([])

      const disconnected = createOwner()
      const { grant } = await connectOwner(disconnected)
      await eraseIntegrationCredentials(fork(), GRANT_ROW_ID, scopeOf(disconnected))
      const tombstones = await readRawGrantRows(disconnected)

      await expectGrantError(
        updateProviderData(disconnected, { externalAccountId: 'acct-1' }, { expectedRevisedAt: grant.revisedAt }),
        'not_connected',
      )
      expect(await readRawGrantRows(disconnected)).toEqual(tombstones)
      expect(await readLogs(disconnected, EXTERNAL_ACCOUNT_SELECTED)).toEqual([])
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('answers transient with the grant unchanged when the Grant Lock stays held past the 15 s deadline', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const before = await readRawGrantRows(owner)
      const requestedDeadlines: Array<number | undefined> = []
      mockWithAdvisoryXactLock.mockImplementation((em, key, fn, options) => {
        requestedDeadlines.push(options?.waitDeadlineMs)
        return actualLock.withAdvisoryXactLock(em, key, fn, { ...options, waitDeadlineMs: 300 })
      })
      const held = await holdGrantLock(owner)
      try {
        await expectGrantError(
          updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: grant.revisedAt }),
          'transient',
        )
      } finally {
        await held.release()
      }

      expect(requestedDeadlines).toEqual([15_000])
      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, EXTERNAL_ACCOUNT_SELECTED)).toEqual([])
      expect(reportedCodes()).toEqual([WRITE_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('answers transient and rolls back when a transient database error hits the lock section', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const before = await readRawGrantRows(owner)
      failing.grantUpdates = true

      const outcome = updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: grant.revisedAt })
      await expectGrantError(outcome, 'transient')

      failing.grantUpdates = false
      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(await readLogs(owner, EXTERNAL_ACCOUNT_SELECTED)).toEqual([])
      expect(reportedCodes()).toEqual([WRITE_TRANSIENT])
    }, CASE_TIMEOUT_MS)

    it('rejects a malformed descriptor, data or options before any read, lock or KMS call', async () => {
      const owner = createOwner()
      const kms = countingKms(activeKms)
      const service = createService({ kms })
      const otherIntegration = descriptorOf({ ...owner, integrationId: 'another_integration' })

      await expectDescriptorError(
        service.updateProviderData(otherIntegration, owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: null }),
        'integrationId',
      )
      await expectDescriptorError(
        service.updateProviderData(descriptorOf(owner), owner, ['acct-1'] as unknown as Record<string, unknown>, { expectedRevisedAt: null }),
        'data',
      )
      await expectDescriptorError(
        service.updateProviderData(descriptorOf(owner), owner, { externalAccountId: 'acct-1' }, {} as unknown as ProviderDataOptions),
        'options.expectedRevisedAt',
      )

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(mockReadCredentialRowLayered).not.toHaveBeenCalled()
      expect(kms.calls).toEqual({ getTenantDek: 0, createTenantDek: 0 })
    }, CASE_TIMEOUT_MS)
  })

  describe('DEK pin (A23, provider data)', () => {
    it('answers platform_unavailable before any Grant Lock attempt and calls no KMS after the failed resolution', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const before = await readRawGrantRows(owner)
      const noDekKms = createTestKms({ behavior: 'no_dek' })
      mockWithAdvisoryXactLock.mockClear()

      await expectGrantError(
        updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: grant.revisedAt }, { kms: noDekKms }),
        'platform_unavailable',
      )

      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(noDekKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1 })
      expect(await readRawGrantRows(owner)).toEqual(before)
      expect(reportedCodes()).toEqual([PLATFORM_UNAVAILABLE])
    }, CASE_TIMEOUT_MS)

    it('resolves the DEK once while it backs off several times behind a held Grant Lock', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
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

      const updating = updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: grant.revisedAt }, { kms: pinKms })
      try {
        await waitFor(() => waits >= 3, 'three back-offs behind the held lock')
      } finally {
        await held.release()
      }
      const result = await updating

      expect(result.revisedAt.getTime()).toBeGreaterThanOrEqual(grant.revisedAt.getTime())
      expect(pinKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 0 })
      expect((await readStoredGrant(owner)).providerData).toEqual({ externalAccountId: 'acct-1' })
    }, CASE_TIMEOUT_MS)
  })

  describe('inspectGrant (A27)', () => {
    it('reads an expired grant with no token call, no lock, no write and one DEK resolution', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const expired = await writeStoredGrant(owner, {
        ...grant,
        expiresAt: new Date(Date.now() - 60_000),
        providerData: { externalAccountId: 'acct-1' },
        previousProviderData: { externalAccountId: 'acct-0' },
      })
      const rowsBefore = await readRawGrantRows(owner)
      const mapsBefore = await readScopeMapRows(owner)
      const logsBefore = await readLogs(owner)
      const countersBefore = server().counters()
      const pinKms = countingKms(activeKms)
      mockWithAdvisoryXactLock.mockClear()

      const inspection = await createService({ kms: pinKms }).inspectGrant(descriptorOf(owner), owner)

      expect(inspection).toEqual({
        status: 'active',
        connectionState: 'active',
        unavailableReason: null,
        baseUrlMissing: false,
        expiresAt: expired.expiresAt,
        refreshedAt: null,
        obtainedAt: expired.obtainedAt,
        revisedAt: expired.revisedAt,
        lastFailureClass: null,
        lastFailureAt: null,
        clientChanged: false,
        missingScopes: [],
        hasExternalAccount: true,
        providerData: { externalAccountId: 'acct-1' },
        previousProviderData: { externalAccountId: 'acct-0' },
      })
      expect(server().counters()).toEqual(countersBefore)
      expect(mockWithAdvisoryXactLock).not.toHaveBeenCalled()
      expect(pinKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 0 })
      expect(await readRawGrantRows(owner)).toEqual(rowsBefore)
      expect(await readScopeMapRows(owner)).toEqual(mapsBefore)
      expect(await readLogs(owner)).toEqual(logsBefore)
      expect(mockFindLatestIntegrationLogsByCodes).not.toHaveBeenCalled()
      expect(mapInspectionToHealth(inspection)).toEqual({ status: 'healthy', details: { code: OAUTH_HEALTH_CODES.connected } })
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('carries no token for an active or an invalidated grant', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)

      const active = await createService().inspectGrant(descriptorOf(owner), owner)
      expect(active).toMatchObject({ status: 'active', connectionState: 'active', hasExternalAccount: false })
      expect(active).not.toHaveProperty('accessToken')
      expectNoIssuedToken(active)
      const health = mapInspectionToHealth(active)
      expect(health).toEqual({ status: 'healthy', details: { code: OAUTH_HEALTH_CODES.connected } })
      expectNoIssuedToken(health)

      await writeStoredGrant(owner, { ...grant, status: 'invalidated', invalidatedReason: 'grant_rejected', invalidatedAt: new Date() })
      const invalidated = await createService().inspectGrant(descriptorOf(owner), owner)
      expect(invalidated).toMatchObject({ status: 'invalidated', connectionState: 'invalidated', unavailableReason: null })
      expect(invalidated).not.toHaveProperty('accessToken')
      expectNoIssuedToken(invalidated)
      expect(mapInspectionToHealth(invalidated)).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.invalidated } })
    }, CASE_TIMEOUT_MS)

    const unreadableBlobCases: Array<[string, (owner: OAuthGrantOwner) => Promise<void>]> = [
      ['an envelope sealed with another key', (owner) => corruptEnvelope(owner)],
      ['a blob that decrypts to {}', (owner) => sealEmptyBlob(owner)],
    ]

    it.each(unreadableBlobCases)('reads %s as unavailable with unavailableReason unreadable in both reads', async (_label, makeUnreadable) => {
      const owner = createOwner()
      await connectOwner(owner)
      await makeUnreadable(owner)

      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

      expect(inspection).toEqual({ status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'unreadable', baseUrlMissing: false })
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBe('unavailable')
      expect(mapInspectionToHealth(inspection)).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.platformUnavailable } })
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('reads a failed DEK pin and field-level ciphertext as unavailable with unavailableReason platform in both reads', async () => {
      const pinOwner = createOwner()
      await connectOwner(pinOwner)
      const noDekKms = createTestKms({ behavior: 'no_dek' })

      const failedPin = await createService({ kms: noDekKms }).inspectGrant(descriptorOf(pinOwner), pinOwner)

      expect(failedPin).toEqual({ status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing: false })
      expect(noDekKms.calls).toEqual({ getTenantDek: 1, createTenantDek: 1 })
      expect(await createService({ kms: createTestKms({ behavior: 'no_dek' }) }).readGrantStatus(INTEGRATION_ID, scopeOf(pinOwner))).toBe('unavailable')

      const fieldOwner = createOwner()
      await connectOwner(fieldOwner)
      const grantKms = activeKms
      harness().setKms(createTestKms({ behavior: 'no_dek' }))

      const fieldCiphertext = await createService({ kms: grantKms }).inspectGrant(descriptorOf(fieldOwner), fieldOwner)

      expect(fieldCiphertext).toEqual({ status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing: false })
      expect(await createService({ kms: grantKms }).readGrantStatus(INTEGRATION_ID, scopeOf(fieldOwner))).toBe('unavailable')
      expect(mapInspectionToHealth(fieldCiphertext).details.code).toBe(OAUTH_HEALTH_CODES.platformUnavailable)
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('reports a KMS that throws during the pin once per read and reads unavailable', async () => {
      const owner = createOwner()
      await connectOwner(owner)

      const inspection = await createService({ kms: createTestKms({ behavior: 'fail' }) }).inspectGrant(descriptorOf(owner), owner)
      const status = await createService({ kms: createTestKms({ behavior: 'fail' }) }).readGrantStatus(INTEGRATION_ID, scopeOf(owner))

      expect(inspection).toEqual({ status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing: false })
      expect(status).toBe('unavailable')
      expect(reportedCodes()).toEqual([INSPECT_FAILED, INSPECT_FAILED])
    }, CASE_TIMEOUT_MS)

    it('reads an unreadable Client Configuration as unavailable with unavailableReason platform, not not_configured', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      await createCredentialsService(fork(), null, { kms: createTestKms() })
        .save(INTEGRATION_ID, { clientId: server().clientId, clientSecret: server().clientSecret }, scopeOf(owner))

      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

      expect(inspection).toMatchObject({
        status: 'active',
        connectionState: 'unavailable',
        unavailableReason: 'platform',
        clientChanged: false,
        missingScopes: [],
      })
      expect(mapInspectionToHealth(inspection)).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.platformUnavailable } })
    }, CASE_TIMEOUT_MS)

    it('ranks not_configured over unavailable and over a readable grant', async () => {
      const unreadable = createOwner()
      await connectOwner(unreadable)
      await eraseIntegrationCredentials(fork(), INTEGRATION_ID, scopeOf(unreadable))
      await corruptEnvelope(unreadable)

      const overUnavailable = await createService().inspectGrant(descriptorOf(unreadable), unreadable)

      expect(overUnavailable).toEqual({ status: 'unavailable', connectionState: 'not_configured', unavailableReason: null, baseUrlMissing: false })
      expect(mapInspectionToHealth(overUnavailable).details.code).toBe(OAUTH_HEALTH_CODES.platformUnavailable)

      const emptySecret = createOwner()
      await connectOwner(emptySecret)
      await configureClient(emptySecret, { clientSecret: '' })

      expect(await createService().inspectGrant(descriptorOf(emptySecret), emptySecret)).toMatchObject({
        status: 'active',
        connectionState: 'not_configured',
        unavailableReason: null,
      })

      const unconfigured = createOwner()
      expect(await createService().inspectGrant(descriptorOf(unconfigured), unconfigured)).toEqual({
        status: 'none',
        connectionState: 'not_configured',
        unavailableReason: null,
        baseUrlMissing: false,
        lastDisconnect: null,
      })
    }, CASE_TIMEOUT_MS)

    it('keeps an active grant active with baseUrlMissing in production without APP_URL', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      process.env.NODE_ENV = 'production'
      process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
      delete process.env.APP_URL
      delete process.env.NEXT_PUBLIC_APP_URL

      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

      expect(inspection).toMatchObject({ status: 'active', connectionState: 'active', unavailableReason: null, baseUrlMissing: true })
      expect(mapInspectionToHealth(inspection)).toEqual({ status: 'healthy', details: { code: OAUTH_HEALTH_CODES.connected } })
    }, CASE_TIMEOUT_MS)

    it('reports client_changed, scope drift and the last failure diagnostics', async () => {
      const changed = createOwner()
      await connectOwner(changed)
      await configureClient(changed, { clientId: 'another-client' })

      const clientChanged = await createService().inspectGrant(descriptorOf(changed), changed)
      expect(clientChanged).toMatchObject({ status: 'active', connectionState: 'active', clientChanged: true })
      expect(mapInspectionToHealth(clientChanged)).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.clientChanged } })

      const drifted = createOwner()
      const { grant } = await connectOwner(drifted, { scope: ['test.read'] })
      expect(await createService().inspectGrant(descriptorOf(drifted), drifted)).toMatchObject({ missingScopes: ['test.write'] })
      await configureClient(drifted, { scopes: 'test.read, test.read extra.scope' })
      const configuredDrift = await createService().inspectGrant(descriptorOf(drifted), drifted)
      expect(configuredDrift).toMatchObject({ missingScopes: ['extra.scope'] })
      expect(mapInspectionToHealth(configuredDrift)).toEqual({ status: 'degraded', details: { code: OAUTH_HEALTH_CODES.scopeDrift } })

      const failedAt = new Date(Date.now() - 1000)
      await writeStoredGrant(drifted, { ...grant, lastFailureClass: 'transient', lastFailureAt: failedAt })
      const transient = await createService().inspectGrant(descriptorOf(drifted), drifted)
      expect(transient).toMatchObject({ lastFailureClass: 'transient', lastFailureAt: failedAt })
      expect(mapInspectionToHealth(transient)).toEqual({ status: 'degraded', details: { code: OAUTH_HEALTH_CODES.transient } })

      await writeStoredGrant(drifted, { ...grant, lastFailureClass: 'client_misconfigured', lastFailureAt: failedAt })
      const misconfigured = await createService().inspectGrant(descriptorOf(drifted), drifted)
      expect(mapInspectionToHealth(misconfigured)).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.clientMisconfigured } })
    }, CASE_TIMEOUT_MS)

    it('reports hasExternalAccount and both provider data values after updateProviderData', async () => {
      const owner = createOwner()
      const { result } = await connectOwner(owner)
      const updated = await updateProviderData(owner, { externalAccountId: 'acct-1' }, { expectedRevisedAt: result.revisedAt })

      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

      expect(inspection).toMatchObject({
        hasExternalAccount: true,
        providerData: { externalAccountId: 'acct-1' },
        previousProviderData: null,
        revisedAt: updated.revisedAt,
      })
    }, CASE_TIMEOUT_MS)

    describe('lastDisconnect', () => {
      const outcomeCases: Array<[string, string | null]> = [
        ['pending', null],
        ['confirmed', 'integrations.oauth_revocation_confirmed'],
        ['failed', 'integrations.oauth_revocation_failed'],
        ['unsupported', 'integrations.oauth_revocation_unsupported'],
        ['skipped', 'integrations.oauth_revocation_skipped_reconnected'],
        ['skipped', 'integrations.oauth_revocation_skipped_invalidated'],
      ]

      it.each(outcomeCases)('derives revocation %s from the latest Disconnect entries (%s)', async (revocation, outcomeCode) => {
        const owner = createOwner()
        await configureClient(owner)
        const earlierDisconnectId = randomUUID()
        const latestDisconnectId = randomUUID()
        const firstAt = new Date(Date.now() - 60_000)
        const latestAt = new Date(firstAt.getTime() + 20_000)
        await insertLog(owner, DISCONNECTED, earlierDisconnectId, firstAt)
        await insertLog(owner, REVOCATION_PENDING, earlierDisconnectId, firstAt)
        await insertLog(owner, 'integrations.oauth_revocation_confirmed', earlierDisconnectId, new Date(firstAt.getTime() + 1000))
        await insertLog(owner, DISCONNECTED, latestDisconnectId, latestAt)
        await insertLog(owner, REVOCATION_PENDING, latestDisconnectId, latestAt)
        if (outcomeCode) await insertLog(owner, outcomeCode, latestDisconnectId, new Date(latestAt.getTime() + 1000))

        const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

        expect(inspection).toEqual({
          status: 'none',
          connectionState: 'not_connected',
          unavailableReason: null,
          baseUrlMissing: false,
          lastDisconnect: { at: latestAt, disconnectId: latestDisconnectId, revocation },
        })
        expect(mapInspectionToHealth(inspection)).toEqual({ status: 'unhealthy', details: { code: OAUTH_HEALTH_CODES.notConnected } })
      }, CASE_TIMEOUT_MS)

      it('ignores a revocation outcome older than the Disconnect entry', async () => {
        const owner = createOwner()
        await configureClient(owner)
        const disconnectId = randomUUID()
        const disconnectedAt = new Date(Date.now() - 60_000)
        await insertLog(owner, 'integrations.oauth_revocation_confirmed', disconnectId, new Date(disconnectedAt.getTime() - 1000))
        await insertLog(owner, DISCONNECTED, disconnectId, disconnectedAt)
        await insertLog(owner, REVOCATION_PENDING, disconnectId, disconnectedAt)

        const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

        expect(inspection).toMatchObject({ lastDisconnect: { at: disconnectedAt, disconnectId, revocation: 'pending' } })
      }, CASE_TIMEOUT_MS)

      it('reads no lastDisconnect without Disconnect entries and while a grant is live', async () => {
        const owner = createOwner()
        await configureClient(owner)

        expect(await createService().inspectGrant(descriptorOf(owner), owner)).toEqual({
          status: 'none',
          connectionState: 'not_connected',
          unavailableReason: null,
          baseUrlMissing: false,
          lastDisconnect: null,
        })

        await insertLog(owner, DISCONNECTED, randomUUID(), new Date(Date.now() - 60_000))
        await connectOwner(owner, { configure: false })
        mockFindLatestIntegrationLogsByCodes.mockClear()

        const live = await createService().inspectGrant(descriptorOf(owner), owner)
        expect(live.status).toBe('active')
        expect(live).not.toHaveProperty('lastDisconnect')
        expect(mockFindLatestIntegrationLogsByCodes).not.toHaveBeenCalled()
      }, CASE_TIMEOUT_MS)

      it('reads lastDisconnect null and reports once when the log query fails', async () => {
        const owner = createOwner()
        await configureClient(owner)
        await insertLog(owner, DISCONNECTED, randomUUID(), new Date(Date.now() - 60_000))
        mockFindLatestIntegrationLogsByCodes.mockRejectedValueOnce(new Error('[internal] simulated log query failure'))

        const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

        expect(inspection).toEqual({
          status: 'none',
          connectionState: 'not_connected',
          unavailableReason: null,
          baseUrlMissing: false,
          lastDisconnect: null,
        })
        expect(reportedCodes()).toEqual([INSPECT_FAILED])
      }, CASE_TIMEOUT_MS)
    })

    it('never throws on a read failure: it reads unavailable and reports once', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      mockReadCredentialRowLayered.mockRejectedValueOnce(new Error('[internal] simulated read failure'))

      const inspection = await createService().inspectGrant(descriptorOf(owner), owner)

      expect(inspection).toEqual({ status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'platform', baseUrlMissing: false })
      expect(reportedCodes()).toEqual([INSPECT_FAILED])
      expectNoIssuedToken(reportError.mock.calls)
    }, CASE_TIMEOUT_MS)

    it('runs concurrent reads over one request EntityManager on detached forks', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)
      const service = createService()

      const [first, second, status] = await Promise.all([
        service.inspectGrant(descriptorOf(owner), owner),
        service.inspectGrant(descriptorOf(owner), owner),
        service.readGrantStatus(INTEGRATION_ID, scopeOf(owner)),
      ])

      expect(first).toMatchObject({ status: 'active', revisedAt: grant.revisedAt })
      expect(second).toEqual(first)
      expect(status).toBe('active')
    }, CASE_TIMEOUT_MS)

    it('validates the descriptor and the owner before any read', async () => {
      const owner = createOwner()

      await expectDescriptorError(
        createService().inspectGrant(descriptorOf({ ...owner, integrationId: 'another_integration' }), owner),
        'integrationId',
      )
      expect(mockReadCredentialRowLayered).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)
  })

  describe('readGrantStatus', () => {
    it('answers null without a live grant after one existence lookup, without a DEK or a decrypt', async () => {
      const owner = createOwner()
      await configureClient(owner)
      const kms = countingKms(activeKms)
      mockReadCredentialRowLayered.mockClear()

      expect(await createService({ kms }).readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBeNull()

      expect(kms.calls).toEqual({ getTenantDek: 0, createTenantDek: 0 })
      expect(mockReadCredentialRowLayered).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('answers the stored status of the owner scope only, and null after an erase', async () => {
      const owner = createOwner()
      const { grant } = await connectOwner(owner)

      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBe('active')
      expect(await createService().readGrantStatus(INTEGRATION_ID, { ...scopeOf(owner), organizationId: randomUUID() })).toBeNull()
      expect(await createService().readGrantStatus('another_integration', scopeOf(owner))).toBeNull()

      await writeStoredGrant(owner, { ...grant, status: 'invalidated', invalidatedReason: 'no_refresh_token', invalidatedAt: new Date() })
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBe('invalidated')

      await eraseIntegrationCredentials(fork(), GRANT_ROW_ID, scopeOf(owner))
      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBeNull()
      expect(reportError).not.toHaveBeenCalled()
    }, CASE_TIMEOUT_MS)

    it('never throws: an unexpected error reads unavailable and is reported once', async () => {
      const owner = createOwner()
      await connectOwner(owner)
      mockReadCredentialRowLayered.mockRejectedValueOnce(new Error('[internal] simulated read failure'))

      expect(await createService().readGrantStatus(INTEGRATION_ID, scopeOf(owner))).toBe('unavailable')

      expect(reportedCodes()).toEqual([INSPECT_FAILED])
    }, CASE_TIMEOUT_MS)
  })
})
