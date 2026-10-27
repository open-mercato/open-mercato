import { randomUUID } from 'node:crypto'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { startPgTestOrm, type PgTestOrm, type PgTestPool } from '../../__tests__/support/pgTestOrm'
import {
  INTEGRATION_STATES_SCOPE_UNIQUE,
  Migration20261027090000_integrations,
} from '../../migrations/Migration20261027090000_integrations'
import { createIntegrationStateService } from '../state-service'

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: jest.fn(),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const CASE_TIMEOUT_MS = 30_000
const INTEGRATION_ID = 'test_state_race'
const CONCURRENT_WRITERS = 8
const ROUNDS = 5

type StateRow = {
  id: string
  is_enabled: boolean
  reauth_required: boolean
  api_version: string | null
  last_health_status: string | null
  enabled_at: Date | null
}

type SeedRow = {
  scope: IntegrationScope
  apiVersion: string
  updatedAt: string
  createdAt: string
  deletedAt?: string
}

function createScope(): IntegrationScope {
  return { tenantId: randomUUID(), organizationId: randomUUID() }
}

describeWithPostgres('integration state upsert against real PostgreSQL', () => {
  let pg: PgTestOrm | null = null
  let pool: PgTestPool | null = null

  function writers(): PgTestPool {
    if (!pool) throw new Error('[internal] writer pool is not started')
    return pool
  }

  async function readRows(integrationId: string, scope: IntegrationScope): Promise<StateRow[]> {
    if (!pg) throw new Error('[internal] pgTestOrm is not started')
    return pg.em.fork().execute<StateRow[]>(
      `select "id", "is_enabled", "reauth_required", "api_version", "last_health_status", "enabled_at" from "integration_states"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ? and "deleted_at" is null`,
      [integrationId, scope.tenantId, scope.organizationId],
    )
  }

  function harness(): PgTestOrm {
    if (!pg) throw new Error('[internal] pgTestOrm is not started')
    return pg
  }

  async function runMigration(direction: 'up' | 'down'): Promise<void> {
    const { orm } = harness()
    const migration = new Migration20261027090000_integrations(orm.em.getDriver(), orm.config)
    if (direction === 'up') await migration.up()
    else await migration.down()
    await orm.em.fork().transactional(async (txEm) => {
      for (const query of migration.getQueries()) await txEm.execute(String(query))
    })
  }

  async function uniqueIndexExists(): Promise<boolean> {
    const rows = await harness().em.fork().execute<Array<{ present: boolean }>>(
      `select to_regclass(?) is not null as "present"`,
      [INTEGRATION_STATES_SCOPE_UNIQUE],
    )
    return rows[0]?.present === true
  }

  async function seedRow(integrationId: string, row: SeedRow): Promise<void> {
    await harness().em.fork().execute(
      `insert into "integration_states"
         ("id", "integration_id", "is_enabled", "api_version", "reauth_required", "organization_id", "tenant_id", "created_at", "updated_at", "deleted_at")
       values (gen_random_uuid(), ?, true, ?, false, ?, ?, ?, ?, ?)`,
      [
        integrationId,
        row.apiVersion,
        row.scope.organizationId,
        row.scope.tenantId,
        row.createdAt,
        row.updatedAt,
        row.deletedAt ?? null,
      ],
    )
  }

  async function readAllVersions(integrationId: string, scope: IntegrationScope): Promise<Array<{ api_version: string; active: boolean }>> {
    return harness().em.fork().execute(
      `select "api_version", "deleted_at" is null as "active" from "integration_states"
       where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ?
       order by "api_version" asc`,
      [integrationId, scope.tenantId, scope.organizationId],
    )
  }

  beforeAll(async () => {
    pg = await startPgTestOrm()
    pool = await pg.openPool({ poolMax: CONCURRENT_WRITERS + 2, acquireTimeoutMs: 10_000 })
  }, 120_000)

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
  })

  afterAll(async () => {
    await pool?.close()
    await pg?.close()
  }, 30_000)

  it('keeps one state row when concurrent first writes race for the same integration', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const scope = createScope()
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_WRITERS }, () =>
          createIntegrationStateService(writers().em.fork()).upsert(INTEGRATION_ID, { isEnabled: true }, scope),
        ),
      )

      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
      const rows = await readRows(INTEGRATION_ID, scope)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.enabled_at).not.toBeNull()
    }
  }, CASE_TIMEOUT_MS)

  it('applies every concurrent first write with different fields to the one row', async () => {
    const scope = createScope()
    const writes = [
      { isEnabled: true },
      { reauthRequired: true },
      { apiVersion: 'v2' },
      { lastHealthStatus: 'healthy' as const, lastHealthCheckedAt: new Date(), lastHealthLatencyMs: 12 },
    ]
    const results = await Promise.allSettled(
      writes.map((input) => createIntegrationStateService(writers().em.fork()).upsert(INTEGRATION_ID, input, scope)),
    )

    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    const rows = await readRows(INTEGRATION_ID, scope)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      is_enabled: true,
      reauth_required: true,
      api_version: 'v2',
      last_health_status: 'healthy',
    })
  }, CASE_TIMEOUT_MS)

  it('keeps writes for different scopes on their own rows', async () => {
    const first = createScope()
    const second = { ...first, organizationId: randomUUID() }
    await Promise.all([
      createIntegrationStateService(writers().em.fork()).upsert(INTEGRATION_ID, { isEnabled: true }, first),
      createIntegrationStateService(writers().em.fork()).upsert(INTEGRATION_ID, { isEnabled: false }, second),
    ])

    expect(await readRows(INTEGRATION_ID, first)).toEqual([expect.objectContaining({ is_enabled: true })])
    expect(await readRows(INTEGRATION_ID, second)).toEqual([expect.objectContaining({ is_enabled: false })])
  }, CASE_TIMEOUT_MS)

  it('rolls the state write back with the caller transaction it joined', async () => {
    const scope = createScope()
    await expect(
      harness().em.fork().transactional(async (outerEm) => {
        await createIntegrationStateService(outerEm).upsert(INTEGRATION_ID, { isEnabled: true }, scope)
        throw new Error('[internal] caller rollback')
      }),
    ).rejects.toThrow('[internal] caller rollback')

    expect(await readRows(INTEGRATION_ID, scope)).toEqual([])
  }, CASE_TIMEOUT_MS)

  it('hands the written values back to a caller that read the state first', async () => {
    const scope = createScope()
    await createIntegrationStateService(writers().em.fork()).upsert(INTEGRATION_ID, { apiVersion: 'v1' }, scope)
    const callerEm = writers().em.fork()
    const service = createIntegrationStateService(callerEm)
    const loaded = await service.get(INTEGRATION_ID, scope)
    expect(loaded?.apiVersion).toBe('v1')

    const written = await service.upsert(INTEGRATION_ID, { apiVersion: 'v2', isEnabled: true }, scope)

    expect(written.apiVersion).toBe('v2')
    expect((await service.resolveState(INTEGRATION_ID, scope)).apiVersion).toBe('v2')
    expect(await service.resolveApiVersion(INTEGRATION_ID, scope)).toBe('v2')
    expect(await readRows(INTEGRATION_ID, scope)).toEqual([expect.objectContaining({ api_version: 'v2', is_enabled: true })])
  }, CASE_TIMEOUT_MS)

  it('migration keeps the newest active row per scope and then enforces one active row', async () => {
    const integrationId = `${INTEGRATION_ID}_migration`
    const first = createScope()
    const second = createScope()
    await harness().em.fork().execute(`drop index if exists "${INTEGRATION_STATES_SCOPE_UNIQUE}"`)
    try {
      await seedRow(integrationId, { scope: first, apiVersion: 'a-old', createdAt: '2026-01-01', updatedAt: '2026-01-02' })
      await seedRow(integrationId, { scope: first, apiVersion: 'b-newest', createdAt: '2026-01-01', updatedAt: '2026-03-01' })
      await seedRow(integrationId, { scope: first, apiVersion: 'c-deleted', createdAt: '2026-04-01', updatedAt: '2026-04-02', deletedAt: '2026-04-03' })
      await seedRow(integrationId, { scope: second, apiVersion: 'd-tie-older-created', createdAt: '2026-01-01', updatedAt: '2026-02-01' })
      await seedRow(integrationId, { scope: second, apiVersion: 'e-tie-newer-created', createdAt: '2026-01-05', updatedAt: '2026-02-01' })

      await runMigration('up')

      expect(await uniqueIndexExists()).toBe(true)
      expect(await readAllVersions(integrationId, first)).toEqual([
        { api_version: 'a-old', active: false },
        { api_version: 'b-newest', active: true },
        { api_version: 'c-deleted', active: false },
      ])
      expect(await readAllVersions(integrationId, second)).toEqual([
        { api_version: 'd-tie-older-created', active: false },
        { api_version: 'e-tie-newer-created', active: true },
      ])
      await expect(
        seedRow(integrationId, { scope: first, apiVersion: 'f-duplicate', createdAt: '2026-05-01', updatedAt: '2026-05-01' }),
      ).rejects.toThrow(/integration_states_scope_unique_idx/)
      await seedRow(integrationId, { scope: first, apiVersion: 'g-deleted', createdAt: '2026-05-01', updatedAt: '2026-05-01', deletedAt: '2026-05-02' })

      await runMigration('down')
      expect(await uniqueIndexExists()).toBe(false)
    } finally {
      await runMigration('up')
    }
    expect(await uniqueIndexExists()).toBe(true)
  }, CASE_TIMEOUT_MS)
})
