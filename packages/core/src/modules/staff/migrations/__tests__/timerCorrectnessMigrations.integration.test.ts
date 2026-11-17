/** @jest-environment node */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20260809183926_staff } from '../Migration20260809183926_staff'
import { Migration20260826193000_staff_segment_orphan_backfill } from '../Migration20260826193000_staff_segment_orphan_backfill'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'staff_migration_test'
const DATABASE_USER = 'staff_migration'
const DATABASE_PASSWORD = 'staff_migration'
const PREFERENCE_INDEX = 'staff_timesheet_preferences_unique_idx'

type MigrationClass = { prototype: { up(): Promise<void>; down(): Promise<void> } }

type SegmentRow = {
  id: string
  started_at: Date
  ended_at: Date | null
  updated_at: Date
  deleted_at: Date | null
}

describeWithPostgres('staff timer-correctness migrations against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined
  let schema: string

  function database(): Client {
    if (!client) throw new Error('[internal] staff migration test database is not connected')
    return client
  }

  async function collect(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
    const migration = Object.create(migrationClass.prototype) as MigrationClass['prototype']
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
    await migration[direction]()
    return statements
  }

  async function migrate(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<void> {
    const statements = await collect(migrationClass, direction)
    await database().query('begin')
    try {
      for (const statement of statements) await database().query(statement)
      await database().query('commit')
    } catch (error) {
      await database().query('rollback')
      throw error
    }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: DATABASE_NAME, POSTGRES_USER: DATABASE_USER, POSTGRES_PASSWORD: DATABASE_PASSWORD })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
    })
    await client.connect()
  }, 120_000)

  beforeEach(async () => {
    schema = `staff_migration_${randomUUID().replaceAll('-', '')}`
    await database().query(`create schema "${schema}"`)
    await database().query(`set search_path to "${schema}"`)
  })

  afterEach(async () => {
    await database().query('set search_path to public')
    await database().query(`drop schema if exists "${schema}" cascade`)
  })

  afterAll(async () => {
    try {
      await client?.end()
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  describe('Migration20260809183926_staff (timesheet preferences)', () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()

    async function tableExists(): Promise<boolean> {
      const result = await database().query<{ present: string | null }>(
        `select to_regclass($1) as present`,
        [`"${schema}".staff_timesheet_preferences`],
      )
      return result.rows[0].present !== null
    }

    async function preferenceIndexes(): Promise<string[]> {
      const result = await database().query<{ indexdef: string }>(
        'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
        [schema, PREFERENCE_INDEX],
      )
      return result.rows.map((row) => row.indexdef)
    }

    async function insertPreference(staffMemberId: string, deletedAt: string | null = null): Promise<void> {
      await database().query(
        `insert into staff_timesheet_preferences
           (tenant_id, organization_id, staff_member_id, last_project_id, created_at, updated_at, deleted_at)
         values ($1, $2, $3, $4, now(), now(), $5)`,
        [tenantId, organizationId, staffMemberId, randomUUID(), deletedAt],
      )
    }

    async function upsertPreference(staffMemberId: string, lastProjectId: string): Promise<string> {
      const result = await database().query<{ last_project_id: string }>(
        `insert into staff_timesheet_preferences
           (tenant_id, organization_id, staff_member_id, last_project_id, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())
         on conflict (organization_id, tenant_id, staff_member_id) where deleted_at is null
         do update set last_project_id = excluded.last_project_id, updated_at = now()
         returning last_project_id`,
        [tenantId, organizationId, staffMemberId, lastProjectId],
      )
      return result.rows[0].last_project_id
    }

    async function expectPartialUniqueIndexEnforced(): Promise<void> {
      const indexes = await preferenceIndexes()
      expect(indexes).toHaveLength(1)
      expect(indexes[0]).toContain('CREATE UNIQUE INDEX')
      expect(indexes[0]).toContain('(organization_id, tenant_id, staff_member_id)')
      expect(indexes[0]).toContain('WHERE (deleted_at IS NULL)')

      const member = randomUUID()
      await insertPreference(member)
      await expect(insertPreference(member)).rejects.toMatchObject({ code: '23505', constraint: PREFERENCE_INDEX })
      await expect(insertPreference(member, '2026-01-01T00:00:00.000Z')).resolves.toBeUndefined()
      await expect(insertPreference(randomUUID())).resolves.toBeUndefined()

      const upserted = randomUUID()
      const replacement = randomUUID()
      await expect(upsertPreference(upserted, randomUUID())).resolves.toBeDefined()
      await expect(upsertPreference(upserted, replacement)).resolves.toBe(replacement)
      const live = await database().query(
        'select id from staff_timesheet_preferences where staff_member_id = $1 and deleted_at is null',
        [upserted],
      )
      expect(live.rows).toHaveLength(1)
    }

    it('creates the table with its partial unique index, drops it on down and recreates it on reapply', async () => {
      await migrate(Migration20260809183926_staff, 'up')
      expect(await tableExists()).toBe(true)
      await expectPartialUniqueIndexEnforced()

      await migrate(Migration20260809183926_staff, 'down')
      expect(await tableExists()).toBe(false)
      expect(await preferenceIndexes()).toHaveLength(0)

      await migrate(Migration20260809183926_staff, 'down')
      expect(await tableExists()).toBe(false)

      await migrate(Migration20260809183926_staff, 'up')
      expect(await tableExists()).toBe(true)
      const reapplied = await database().query('select id from staff_timesheet_preferences')
      expect(reapplied.rows).toHaveLength(0)
      await expectPartialUniqueIndexEnforced()
    })
  })

  describe('Migration20260826193000_staff_segment_orphan_backfill', () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const fixtureUpdatedAt = '2026-01-01T00:00:00.000Z'
    const parentDeletedAt = '2026-02-10T12:00:00.000Z'
    const earlierDeletedAt = '2026-02-05T09:00:00.000Z'

    beforeEach(async () => {
      await database().query(`create table staff_time_entries (
        id uuid primary key, tenant_id uuid not null, organization_id uuid not null,
        started_at timestamptz null, ended_at timestamptz null,
        created_at timestamptz not null, updated_at timestamptz not null, deleted_at timestamptz null
      )`)
      await database().query(`create table staff_time_entry_segments (
        id uuid primary key, tenant_id uuid not null, organization_id uuid not null,
        time_entry_id uuid not null, started_at timestamptz not null, ended_at timestamptz null,
        created_at timestamptz not null, updated_at timestamptz not null, deleted_at timestamptz null
      )`)
    })

    async function insertEntry(endedAt: string | null, deletedAt: string | null): Promise<string> {
      const id = randomUUID()
      await database().query(
        `insert into staff_time_entries (id, tenant_id, organization_id, started_at, ended_at, created_at, updated_at, deleted_at)
         values ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [id, tenantId, organizationId, '2026-02-01T08:00:00.000Z', endedAt, fixtureUpdatedAt, deletedAt],
      )
      return id
    }

    async function insertSegment(entryId: string, startedAt: string, endedAt: string | null, deletedAt: string | null): Promise<string> {
      const id = randomUUID()
      await database().query(
        `insert into staff_time_entry_segments (id, tenant_id, organization_id, time_entry_id, started_at, ended_at, created_at, updated_at, deleted_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
        [id, tenantId, organizationId, entryId, startedAt, endedAt, fixtureUpdatedAt, deletedAt],
      )
      return id
    }

    async function segments(): Promise<Map<string, SegmentRow>> {
      const result = await database().query<SegmentRow>(
        'select id, started_at, ended_at, updated_at, deleted_at from staff_time_entry_segments order by id',
      )
      return new Map(result.rows.map((row) => [row.id, row]))
    }

    function iso(value: Date | null | undefined): string | null {
      return value ? value.toISOString() : null
    }

    it('repairs open and closed orphans only, reruns as a no-op and leaves its no-op down() inert', async () => {
      const deletedParent = await insertEntry(null, parentDeletedAt)
      const staleEndParent = await insertEntry('2026-02-01T09:00:00.000Z', parentDeletedAt)
      const liveParent = await insertEntry(null, null)

      const openOrphan = await insertSegment(deletedParent, '2026-02-10T10:00:00.000Z', null, null)
      const closedOrphan = await insertSegment(deletedParent, '2026-02-10T08:00:00.000Z', '2026-02-10T09:30:00.000Z', null)
      const staleEndOrphan = await insertSegment(staleEndParent, '2026-02-03T10:00:00.000Z', null, null)
      const liveOpen = await insertSegment(liveParent, '2026-02-10T10:00:00.000Z', null, null)
      const liveClosed = await insertSegment(liveParent, '2026-02-10T08:00:00.000Z', '2026-02-10T09:00:00.000Z', null)
      const previouslyDeleted = await insertSegment(deletedParent, '2026-02-04T08:00:00.000Z', '2026-02-04T09:00:00.000Z', earlierDeletedAt)
      const previouslyDeletedOpen = await insertSegment(deletedParent, '2026-02-04T10:00:00.000Z', null, earlierDeletedAt)

      const before = await segments()
      await migrate(Migration20260826193000_staff_segment_orphan_backfill, 'up')
      const after = await segments()

      expect(after.size).toBe(7)
      for (const id of [openOrphan, closedOrphan, staleEndOrphan]) {
        expect(iso(after.get(id)?.deleted_at)).toBe(parentDeletedAt)
        expect(after.get(id)?.updated_at.getTime()).toBeGreaterThan(new Date(fixtureUpdatedAt).getTime())
      }
      expect(iso(after.get(openOrphan)?.ended_at)).toBe(parentDeletedAt)
      expect(iso(after.get(closedOrphan)?.ended_at)).toBe('2026-02-10T09:30:00.000Z')
      expect(iso(after.get(staleEndOrphan)?.ended_at)).toBe(parentDeletedAt)
      for (const id of [liveOpen, liveClosed, previouslyDeleted, previouslyDeletedOpen]) {
        expect(after.get(id)).toEqual(before.get(id))
      }
      expect(iso(after.get(previouslyDeleted)?.deleted_at)).toBe(earlierDeletedAt)
      expect(after.get(previouslyDeletedOpen)?.ended_at).toBeNull()

      await migrate(Migration20260826193000_staff_segment_orphan_backfill, 'up')
      expect(await segments()).toEqual(after)

      expect(await collect(Migration20260826193000_staff_segment_orphan_backfill, 'down')).toEqual([])
      await migrate(Migration20260826193000_staff_segment_orphan_backfill, 'down')
      const afterDown = await segments()
      expect(afterDown).toEqual(after)
      for (const id of [openOrphan, closedOrphan, staleEndOrphan]) {
        expect(afterDown.get(id)?.deleted_at).not.toBeNull()
      }

      await migrate(Migration20260826193000_staff_segment_orphan_backfill, 'up')
      expect(await segments()).toEqual(after)
    })
  })
})
