import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { upsertCanonicalEncryptionMap } from '../../../entities/lib/encryption-maps'
import { createTestKms, startPgTestOrm, type PgTestOrm } from '../../__tests__/support/pgTestOrm'
import {
  createCredentialsService,
  eraseIntegrationCredentials,
  readCredentialRowLayered,
} from '../credentials-service'
import { createIntegrationLogService, findLatestIntegrationLogsByCodes } from '../log-service'

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: jest.fn(),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 20_000
const INTEGRATION_ID = 'test_oauth_grant'
const CREDENTIALS_ENTITY_ID = 'integrations:integration_credentials'
const ENVELOPE_KEY = '__om_encrypted_credentials_blob_v1'
const DISCONNECTED = 'integrations.oauth_disconnected'
const REVOCATION_PENDING = 'integrations.oauth_revocation_pending'
const REVOCATION_CONFIRMED = 'integrations.oauth_revocation_confirmed'

type StoredRow = { id: string; credentials: unknown; deleted_at: string | null }

type MapRow = { is_active: boolean; fields_json: unknown; updated_at: string }

type Secret = { secret: string }

function createNoDekKms(): KmsService {
  return createTestKms({ behavior: 'no_dek' })
}

function createScope(): IntegrationScope {
  return { tenantId: randomUUID(), organizationId: randomUUID() }
}

function validateSecret(value: Record<string, unknown>): Secret | null {
  return typeof value.secret === 'string' ? { secret: value.secret } : null
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

describeWithPostgres('integrations credentials and logs against real PostgreSQL', () => {
  let pg: PgTestOrm | null = null

  function harness(): PgTestOrm {
    if (!pg) throw new Error('[internal] pgTestOrm is not started')
    return pg
  }

  function fork(): EntityManager {
    return harness().em.fork()
  }

  function setKms(kms: KmsService): void {
    harness().setKms(kms)
  }

  async function readStoredRows(integrationId: string, scope: IntegrationScope): Promise<StoredRow[]> {
    return fork().execute<StoredRow[]>(
      `select "id", "credentials", "deleted_at" from "integration_credentials"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by "created_at" asc`,
      [integrationId, scope.tenantId, scope.organizationId],
    )
  }

  async function writeRawCredentials(scope: IntegrationScope, credentials: unknown): Promise<string> {
    const [row] = await fork().execute<Array<{ id: string }>>(
      `insert into "integration_credentials"
         ("id", "integration_id", "credentials", "organization_id", "tenant_id", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?::jsonb, ?, ?, now(), now()) returning "id"`,
      [INTEGRATION_ID, JSON.stringify(credentials), scope.organizationId, scope.tenantId],
    )
    return row.id
  }

  async function readMapRow(scope: IntegrationScope): Promise<MapRow | null> {
    const rows = await fork().execute<MapRow[]>(
      `select "is_active", "fields_json", "updated_at"::text as "updated_at" from "encryption_maps"
       where "entity_id" = ? and "tenant_id" = ? and "organization_id" = ? and "deleted_at" is null`,
      [CREDENTIALS_ENTITY_ID, scope.tenantId, scope.organizationId],
    )
    return rows[0] ?? null
  }

  beforeAll(async () => {
    pg = await startPgTestOrm()
  }, 120_000)

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    setKms(createTestKms())
  })

  afterAll(async () => {
    await pg?.close()
  }, 30_000)

  describe('credential scope serialization', () => {
    it('serializes first saves across connection pools and keeps one encrypted live row', async () => {
      const scope = createScope()
      const options = { ensureEncryptionMap: 'when-not-canonical' } as const
      await upsertCanonicalEncryptionMap(fork(), {
        entityId: CREDENTIALS_ENTITY_ID,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        fields: [{ field: 'credentials' }],
        isActive: true,
      })
      const otherPool = await harness().openPool()
      let concurrentSave: Promise<void> | undefined
      try {
        await fork().transactional(async (tx) => {
          const [{ pid }] = await tx.execute<Array<{ pid: number }>>('select pg_backend_pid() as pid')
          await createCredentialsService(tx).save(INTEGRATION_ID, { secret: 'first' }, scope, options)
          concurrentSave = createCredentialsService(otherPool.em.fork()).save(
            INTEGRATION_ID,
            { secret: 'second' },
            { ...scope, organizationId: scope.organizationId.toUpperCase(), userId: null },
            options,
          )
          const finished = concurrentSave.then(() => false)
          const observer = fork()
          const deadline = Date.now() + 3_000
          const waiting = async () => {
            while (Date.now() < deadline) {
              const [row] = await observer.execute<Array<{ blocked: boolean }>>(
                `select exists (select 1 from pg_locks
                  where locktype = 'advisory' and not granted and ? = any(pg_blocking_pids(pid))) as blocked`,
                [pid],
              )
              if (row?.blocked) return true
              await sleep(25)
            }
            return false
          }
          expect(await Promise.race([waiting(), finished])).toBe(true)
        })
        await concurrentSave
      } finally {
        await concurrentSave?.catch(() => undefined)
        await otherPool.close()
      }

      const rows = await readStoredRows(INTEGRATION_ID, scope)
      expect(rows).toEqual([{ id: expect.any(String), credentials: expect.anything(), deleted_at: null }])
      expect(isEncryptedPayloadShape(rows[0]?.credentials)).toBe(true)
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toEqual({ secret: 'second' })
    }, CASE_TIMEOUT_MS)

    it('selects the newest legacy row and retires duplicates on rotation only within the strict scope', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'no'
      const scope = createScope()
      const userScope = { ...scope, userId: randomUUID() }
      const otherOrg = { ...scope, organizationId: randomUUID() }
      const otherTenant = { ...scope, tenantId: randomUUID() }
      const service = () => createCredentialsService(fork())
      const obsoleteId = await writeRawCredentials(scope, { secret: 'obsolete' })
      const obsoleteVersion = new Date('2020-01-01T00:00:00Z')
      await fork().execute('update integration_credentials set updated_at = ? where id = ?', [
        obsoleteVersion,
        obsoleteId,
      ])
      const currentId = await writeRawCredentials(scope, { secret: 'current' })
      for (const [otherScope, secret] of [[userScope, 'user'], [otherOrg, 'org'], [otherTenant, 'tenant']] as const) {
        await service().save(INTEGRATION_ID, { secret }, otherScope)
      }

      await expect(service().getRaw(INTEGRATION_ID, scope)).resolves.toEqual({ secret: 'current' })
      const version = await service().getRowUpdatedAt(INTEGRATION_ID, scope)
      expect(version?.getTime()).toBeGreaterThan(obsoleteVersion.getTime())
      await expect(readCredentialRowLayered(fork(), INTEGRATION_ID, scope, { kms: createTestKms(), validate: validateSecret }))
        .resolves.toEqual({ kind: 'ok', rowId: currentId, value: { secret: 'current' } })
      await service().save(INTEGRATION_ID, { secret: 'rotated' }, scope)

      const rows = await readStoredRows(INTEGRATION_ID, scope)
      expect(rows.find((row) => row.id === obsoleteId)).toEqual({ id: obsoleteId, credentials: {}, deleted_at: expect.any(String) })
      expect(rows.find((row) => row.id === currentId)).toEqual({ id: currentId, credentials: { secret: 'rotated' }, deleted_at: null })
      await expect(service().getRaw(INTEGRATION_ID, scope)).resolves.toEqual({ secret: 'rotated' })
      await expect(service().getRaw(INTEGRATION_ID, { ...scope, userId: randomUUID() })).resolves.toEqual({ secret: 'rotated' })
      await expect(service().getRaw(INTEGRATION_ID, userScope)).resolves.toEqual({ secret: 'user' })
      await expect(service().getRaw(INTEGRATION_ID, otherOrg)).resolves.toEqual({ secret: 'org' })
      await expect(service().getRaw(INTEGRATION_ID, otherTenant)).resolves.toEqual({ secret: 'tenant' })
    }, CASE_TIMEOUT_MS)
  })

  describe('eraseIntegrationCredentials', () => {
    it('blanks every live legacy duplicate so an erased secret cannot become eligible again', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'no'
      const scope = createScope()
      await writeRawCredentials(scope, { secret: 'obsolete' })
      await writeRawCredentials(scope, { secret: 'current' })

      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, scope)).resolves.toBe(true)

      const rows = await readStoredRows(INTEGRATION_ID, scope)
      expect(rows).toHaveLength(2)
      expect(rows.every((row) => row.deleted_at !== null)).toBe(true)
      expect(rows.map((row) => row.credentials)).toEqual([{}, {}])
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toBeNull()
    }, CASE_TIMEOUT_MS)

    it('blanks and soft-deletes the strict row with encryption enabled, sealing {} at the field level', async () => {
      const kms = createTestKms()
      setKms(kms)
      const scope = createScope()
      const sibling = { ...scope, organizationId: randomUUID() }
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'own' }, scope)
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'sibling' }, sibling)
      const [before] = await readStoredRows(INTEGRATION_ID, scope)
      expect(isEncryptedPayloadShape(before?.credentials)).toBe(true)

      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, scope)).resolves.toBe(true)

      const [after] = await readStoredRows(INTEGRATION_ID, scope)
      expect(after?.id).toBe(before?.id)
      expect(after?.deleted_at).not.toBeNull()
      expect(isEncryptedPayloadShape(after?.credentials)).toBe(true)
      expect(decryptWithAesGcm(String(after?.credentials), String(kms.deks.get(scope.tenantId)))).toBe('{}')
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, sibling)).resolves.toEqual({ secret: 'sibling' })
      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, scope)).resolves.toBe(false)
    }, CASE_TIMEOUT_MS)

    it('erases a plaintext row with encryption disabled', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'no'
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'plain' }, scope)
      const [before] = await readStoredRows(INTEGRATION_ID, scope)
      expect(before?.credentials).toEqual({ secret: 'plain' })

      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, scope)).resolves.toBe(true)

      const [after] = await readStoredRows(INTEGRATION_ID, scope)
      expect(after?.credentials).toEqual({})
      expect(after?.deleted_at).not.toBeNull()
    }, CASE_TIMEOUT_MS)

    it('erases a sealed row while no DEK is available at either layer', async () => {
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'sealed' }, scope)
      setKms(createNoDekKms())
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toEqual({})

      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, scope)).resolves.toBe(true)

      const [after] = await readStoredRows(INTEGRATION_ID, scope)
      expect(after?.credentials).toEqual({})
      expect(after?.deleted_at).not.toBeNull()
    }, CASE_TIMEOUT_MS)

    it('erases only the strict row: a per-user erase never falls through to the tenant-wide row', async () => {
      const scope = createScope()
      const userScope = { ...scope, userId: randomUUID() }
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'tenant' }, scope)
      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, userScope)).resolves.toBe(false)

      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'user' }, userScope)
      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, userScope)).resolves.toBe(true)

      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toEqual({ secret: 'tenant' })
      const userRows = await fork().execute<Array<{ user_id: string | null; deleted_at: string | null }>>(
        `select "user_id", "deleted_at" from "integration_credentials" where "tenant_id" = ? and "user_id" is not null`,
        [scope.tenantId],
      )
      expect(userRows).toEqual([{ user_id: userScope.userId, deleted_at: expect.any(String) }])
    }, CASE_TIMEOUT_MS)

    it('returns false when no live row exists', async () => {
      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, createScope())).resolves.toBe(false)
    }, CASE_TIMEOUT_MS)
  })

  describe('createCredentialsService options', () => {
    it('seals with the kms option while invalidateMap from the second parameter runs on save', async () => {
      const optionKms = createTestKms()
      const scope = createScope()
      const invalidateMap = jest.fn(async () => undefined)

      await createCredentialsService(fork(), { invalidateMap }, { kms: optionKms })
        .save(INTEGRATION_ID, { secret: 'option' }, scope)

      expect(invalidateMap).toHaveBeenCalledTimes(1)
      expect(invalidateMap).toHaveBeenCalledWith(CREDENTIALS_ENTITY_ID, scope.tenantId, scope.organizationId)
      expect(optionKms.deks.has(scope.tenantId)).toBe(true)
      await expect(createCredentialsService(fork(), null, { kms: optionKms }).getRaw(INTEGRATION_ID, scope))
        .resolves.toEqual({ secret: 'option' })
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toEqual({})
    }, CASE_TIMEOUT_MS)

    it('keeps one- and two-argument calls on the default KMS', async () => {
      const scope = createScope()
      const otherScope = createScope()
      const invalidateMap = jest.fn(async () => undefined)

      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'one' }, scope)
      await createCredentialsService(fork(), { invalidateMap }).save(INTEGRATION_ID, { secret: 'two' }, otherScope)

      expect(invalidateMap).toHaveBeenCalledTimes(1)
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toEqual({ secret: 'one' })
      await expect(createCredentialsService(fork(), { invalidateMap }).getRaw(INTEGRATION_ID, otherScope))
        .resolves.toEqual({ secret: 'two' })
    }, CASE_TIMEOUT_MS)
  })

  describe("ensureEncryptionMap: 'when-not-canonical'", () => {
    async function saveWhenNotCanonical(scope: IntegrationScope) {
      const invalidateMap = jest.fn(async () => undefined)
      const deferred: Array<() => void | Promise<void>> = []
      await createCredentialsService(fork(), { invalidateMap }).save(INTEGRATION_ID, { secret: 'grant' }, scope, {
        ensureEncryptionMap: 'when-not-canonical',
        deferAfterCommit: (callback) => deferred.push(callback),
      })
      return { invalidateMap, deferred }
    }

    it('leaves a canonical map untouched and registers no invalidation', async () => {
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'seed' }, scope)
      const before = await readMapRow(scope)

      const { invalidateMap, deferred } = await saveWhenNotCanonical(scope)

      expect(await readMapRow(scope)).toEqual(before)
      expect(deferred).toHaveLength(0)
      expect(invalidateMap).not.toHaveBeenCalled()
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, scope)).resolves.toEqual({ secret: 'grant' })
    }, CASE_TIMEOUT_MS)

    it('upserts a missing map and defers its invalidation', async () => {
      const scope = createScope()

      const { invalidateMap, deferred } = await saveWhenNotCanonical(scope)

      expect(await readMapRow(scope)).toMatchObject({ is_active: true, fields_json: [{ field: 'credentials' }] })
      expect(deferred).toHaveLength(1)
      await deferred[0]?.()
      expect(invalidateMap).toHaveBeenCalledWith(CREDENTIALS_ENTITY_ID, scope.tenantId, scope.organizationId)
    }, CASE_TIMEOUT_MS)

    it('repairs an inactive or non-canonical map', async () => {
      const inactiveScope = createScope()
      const editedScope = createScope()
      await upsertCanonicalEncryptionMap(fork(), {
        entityId: CREDENTIALS_ENTITY_ID,
        tenantId: inactiveScope.tenantId,
        organizationId: inactiveScope.organizationId,
        fields: [{ field: 'credentials' }],
        isActive: false,
      })
      await upsertCanonicalEncryptionMap(fork(), {
        entityId: CREDENTIALS_ENTITY_ID,
        tenantId: editedScope.tenantId,
        organizationId: editedScope.organizationId,
        fields: [{ field: 'credentials', hashField: 'credentials_hash' }],
        isActive: true,
      })
      const inactiveBefore = await readMapRow(inactiveScope)
      const editedBefore = await readMapRow(editedScope)

      const inactive = await saveWhenNotCanonical(inactiveScope)
      const edited = await saveWhenNotCanonical(editedScope)

      for (const [scope, before, result] of [
        [inactiveScope, inactiveBefore, inactive],
        [editedScope, editedBefore, edited],
      ] as const) {
        const after = await readMapRow(scope)
        expect(after).toMatchObject({ is_active: true, fields_json: [{ field: 'credentials' }] })
        expect(after?.updated_at).not.toBe(before?.updated_at)
        expect(result.deferred).toHaveLength(1)
      }
    }, CASE_TIMEOUT_MS)
  })

  describe('readCredentialRowLayered', () => {
    async function readLayered(scope: IntegrationScope, kms: KmsService) {
      return readCredentialRowLayered(fork(), INTEGRATION_ID, scope, { kms, validate: validateSecret })
    }

    it('returns none without a live row and ok for a row sealed at both layers', async () => {
      const kms = createTestKms()
      setKms(kms)
      const scope = createScope()
      await expect(readLayered(scope, kms)).resolves.toEqual({ kind: 'none' })

      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'layered' }, scope)
      const [row] = await readStoredRows(INTEGRATION_ID, scope)

      await expect(readLayered(scope, kms)).resolves.toEqual({ kind: 'ok', rowId: row?.id, value: { secret: 'layered' } })
    }, CASE_TIMEOUT_MS)

    it('returns field_ciphertext when the field-level layer cannot open the row', async () => {
      const kms = createTestKms()
      setKms(kms)
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'layered' }, scope)
      const [row] = await readStoredRows(INTEGRATION_ID, scope)
      setKms(createNoDekKms())

      await expect(readLayered(scope, kms)).resolves.toEqual({ kind: 'field_ciphertext', rowId: row?.id })
    }, CASE_TIMEOUT_MS)

    it('returns no_dek for a KMS without a key and for an envelope read with encryption disabled', async () => {
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'layered' }, scope)
      const [row] = await readStoredRows(INTEGRATION_ID, scope)
      await expect(readLayered(scope, createNoDekKms()))
        .resolves.toEqual({ kind: 'no_dek', rowId: row?.id, reason: 'no-dek' })

      const rawScope = createScope()
      await writeRawCredentials(rawScope, { [ENVELOPE_KEY]: 'sealed-before-encryption-was-switched-off' })
      const [rawRow] = await readStoredRows(INTEGRATION_ID, rawScope)
      process.env.TENANT_DATA_ENCRYPTION = 'no'
      await expect(readLayered(rawScope, createTestKms()))
        .resolves.toEqual({ kind: 'no_dek', rowId: rawRow?.id, reason: 'sealed-while-disabled' })
    }, CASE_TIMEOUT_MS)

    it('returns envelope_undecryptable for an envelope sealed with another key', async () => {
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'layered' }, scope)
      const [row] = await readStoredRows(INTEGRATION_ID, scope)
      const otherKms = createTestKms()
      await otherKms.createTenantDek(scope.tenantId)

      await expect(readLayered(scope, otherKms)).resolves.toEqual({ kind: 'envelope_undecryptable', rowId: row?.id })
    }, CASE_TIMEOUT_MS)

    it('returns invalid schema for a blob that decrypts to {} and invalid parse for a non-object value', async () => {
      const kms = createTestKms()
      setKms(kms)
      const scope = createScope()
      await createCredentialsService(fork()).save(INTEGRATION_ID, {}, scope)
      const [row] = await readStoredRows(INTEGRATION_ID, scope)
      await expect(readLayered(scope, kms)).resolves.toEqual({ kind: 'invalid', rowId: row?.id, cause: 'schema' })

      process.env.TENANT_DATA_ENCRYPTION = 'no'
      const rawScope = createScope()
      await writeRawCredentials(rawScope, ['not', 'an', 'object'])
      const [rawRow] = await readStoredRows(INTEGRATION_ID, rawScope)
      await expect(readLayered(rawScope, kms)).resolves.toEqual({ kind: 'invalid', rowId: rawRow?.id, cause: 'parse' })
    }, CASE_TIMEOUT_MS)
  })

  describe('tenant isolation', () => {
    it("never reads, erases or lists another tenant's credentials or logs, even under the same organization id", async () => {
      const kms = createTestKms()
      setKms(kms)
      const tenantA = createScope()
      const tenantB = { tenantId: randomUUID(), organizationId: tenantA.organizationId }
      await createCredentialsService(fork()).save(INTEGRATION_ID, { secret: 'tenant-b' }, tenantB)
      await createIntegrationLogService(fork()).write({
        integrationId: INTEGRATION_ID,
        level: 'info',
        message: DISCONNECTED,
        code: DISCONNECTED,
        payload: { disconnectId: randomUUID() },
      }, tenantB)

      await expect(readCredentialRowLayered(fork(), INTEGRATION_ID, tenantA, { kms, validate: validateSecret }))
        .resolves.toEqual({ kind: 'none' })
      await expect(createCredentialsService(fork()).getRaw(INTEGRATION_ID, tenantA)).resolves.toBeNull()
      await expect(eraseIntegrationCredentials(fork(), INTEGRATION_ID, tenantA)).resolves.toBe(false)
      await expect(findLatestIntegrationLogsByCodes(fork(), INTEGRATION_ID, [DISCONNECTED], tenantA)).resolves.toEqual([])

      await expect(readCredentialRowLayered(fork(), INTEGRATION_ID, tenantB, { kms, validate: validateSecret }))
        .resolves.toMatchObject({ kind: 'ok', value: { secret: 'tenant-b' } })
      expect((await readStoredRows(INTEGRATION_ID, tenantB)).map((row) => row.deleted_at)).toEqual([null])
      expect(await findLatestIntegrationLogsByCodes(fork(), INTEGRATION_ID, [DISCONNECTED], tenantB)).toHaveLength(1)
    }, CASE_TIMEOUT_MS)
  })

  describe('findLatestIntegrationLogsByCodes', () => {
    it('returns the newest rows of one integration and scope matching the codes and the disconnectId', async () => {
      const scope = createScope()
      const otherOrganization = { ...scope, organizationId: randomUUID() }
      const firstDisconnect = randomUUID()
      const secondDisconnect = randomUUID()
      const write = async (
        target: IntegrationScope,
        code: string,
        disconnectId: string,
        integrationId: string = INTEGRATION_ID,
      ) => {
        await createIntegrationLogService(fork()).write({
          integrationId,
          level: 'info',
          message: code,
          code,
          payload: { disconnectId },
        }, target)
        await sleep(5)
      }
      await write(scope, DISCONNECTED, firstDisconnect)
      await write(scope, REVOCATION_PENDING, firstDisconnect)
      await write(scope, REVOCATION_CONFIRMED, firstDisconnect)
      await write(scope, DISCONNECTED, secondDisconnect)
      await write(scope, REVOCATION_PENDING, secondDisconnect)
      await write(otherOrganization, DISCONNECTED, secondDisconnect)
      await write(scope, DISCONNECTED, secondDisconnect, 'other_integration')

      const latestDisconnect = await findLatestIntegrationLogsByCodes(fork(), INTEGRATION_ID, [DISCONNECTED], scope)
      expect(latestDisconnect.map((log) => log.payload?.disconnectId)).toEqual([secondDisconnect])

      const firstOutcomes = await findLatestIntegrationLogsByCodes(
        fork(), INTEGRATION_ID, [REVOCATION_PENDING, REVOCATION_CONFIRMED], scope,
        { disconnectId: firstDisconnect, limit: 5 },
      )
      expect(firstOutcomes.map((log) => log.code)).toEqual([REVOCATION_CONFIRMED, REVOCATION_PENDING])
      expect(firstOutcomes.every((log) => log.payload?.disconnectId === firstDisconnect)).toBe(true)

      const confirmedOnward = await findLatestIntegrationLogsByCodes(
        fork(), INTEGRATION_ID, [REVOCATION_PENDING, REVOCATION_CONFIRMED], scope,
        { disconnectId: firstDisconnect, createdFrom: firstOutcomes[0]?.createdAt, limit: 5 },
      )
      expect(confirmedOnward.map((log) => log.code)).toEqual([REVOCATION_CONFIRMED])

      const secondOutcome = await findLatestIntegrationLogsByCodes(
        fork(), INTEGRATION_ID, [REVOCATION_CONFIRMED], scope, { disconnectId: secondDisconnect },
      )
      expect(secondOutcome).toEqual([])

      const secondDisconnects = await findLatestIntegrationLogsByCodes(
        fork(), INTEGRATION_ID, [DISCONNECTED], scope, { disconnectId: secondDisconnect, limit: 20 },
      )
      expect(secondDisconnects).toHaveLength(1)
      expect(secondDisconnects[0]).toMatchObject({
        integrationId: INTEGRATION_ID,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
    }, CASE_TIMEOUT_MS)
  })
})
