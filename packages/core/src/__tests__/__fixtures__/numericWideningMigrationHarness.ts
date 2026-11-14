import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'

type MigrationInstance = { up(): void | Promise<void>; down(): void | Promise<void> }
type MigrationClass = { prototype: MigrationInstance; name: string }

export type LegacyNumeric = { precision: number; scale: number }

export type AddedColumn = { table: string; column: string; dataType: string; sample: Record<string, unknown> }

export type NumericWideningCase = {
  migration: MigrationClass
  legacy: LegacyNumeric
  legacyOverrides?: Record<string, LegacyNumeric>
  addedColumns?: AddedColumn[]
}

type WidenedColumn = { table: string; column: string; legacy: LegacyNumeric }
type ColumnInfo = { table_name: string; column_name: string; data_type: string; numeric_precision: number | null; numeric_scale: number | null; is_nullable: string }

const WIDEN_PATTERN = /^alter table "(\w+)" alter column "(\w+)" type numeric using \("\2"::numeric\);$/
const NARROW_PATTERN = /^alter table "(\w+)" alter column "(\w+)" type numeric\((\d+),(\d+)\) using \("\2"::numeric\(\3,\4\)\);$/
const BEYOND_FLOAT = '0.1000000000000000000001'
const HUGE = '123456789012345678901234567890.123456789012345678901234567890'
const LEGACY_ROW_IDS = [1, 2, 3, 4, 5]

function captureSql(migrationClass: MigrationClass, direction: 'up' | 'down'): string[] {
  const migration = Object.create(migrationClass.prototype) as MigrationInstance
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  void migration[direction]()
  return statements
}

function integerDigits(legacy: LegacyNumeric): string {
  return '9'.repeat(legacy.precision - legacy.scale)
}

function legacyFixtures(legacy: LegacyNumeric): Array<string | null> {
  const fraction = legacy.scale > 0 ? `.${'9'.repeat(legacy.scale)}` : ''
  const smallest = legacy.scale > 0 ? `0.${'0'.repeat(legacy.scale - 1)}1` : '1'
  return [`${integerDigits(legacy)}${fraction}`, `-${integerDigits(legacy)}${fraction}`, smallest, '12.5', null]
}

function roundedToLegacyScale(legacy: LegacyNumeric): { input: string; expected: string }[] {
  return [
    { input: BEYOND_FLOAT, expected: legacy.scale > 0 ? `0.1${'0'.repeat(legacy.scale - 1)}` : '0' },
    { input: `0.${'0'.repeat(legacy.scale)}5`, expected: legacy.scale > 0 ? `0.${'0'.repeat(legacy.scale - 1)}1` : '1' },
  ]
}

export function describeNumericWideningMigrations(title: string, cases: NumericWideningCase[]): void {
  const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

  describe(`${title} (static SQL shape)`, () => {
    it.each(cases.map((entry) => [entry.migration.name, entry] as const))('%s up/down only widen and restore the declared legacy columns', (_name, entry) => {
      const added = new Set((entry.addedColumns ?? []).map(({ table, column }) => `${table}.${column}`))
      const widened = captureSql(entry.migration, 'up').flatMap((statement) => {
        const match = WIDEN_PATTERN.exec(statement)
        if (match) return [`${match[1]}.${match[2]}`]
        expect((entry.addedColumns ?? []).some(({ table, column, dataType }) => statement === `alter table "${table}" add "${column}" ${dataType} null;`)).toBe(true)
        return []
      })
      const restored = captureSql(entry.migration, 'down').flatMap((statement) => {
        const match = NARROW_PATTERN.exec(statement)
        if (match) {
          const key = `${match[1]}.${match[2]}`
          expect({ key, precision: Number(match[3]), scale: Number(match[4]) })
            .toEqual({ key, ...(entry.legacyOverrides?.[key] ?? entry.legacy) })
          return [key]
        }
        expect((entry.addedColumns ?? []).some(({ table, column }) => statement === `alter table "${table}" drop column "${column}";`)).toBe(true)
        return []
      })
      expect(widened.length).toBeGreaterThan(0)
      expect([...restored].sort()).toEqual([...widened].sort())
      for (const key of Object.keys(entry.legacyOverrides ?? {})) expect(widened).toContain(key)
      for (const key of added) expect(widened.some((column) => column.startsWith(`${key.split('.')[0]}.`))).toBe(true)
    })
  })

  describeWithPostgres(`${title} against PostgreSQL`, () => {
    let postgres: StartedTestContainer | undefined
    let client: Client | undefined
    let schema: string

    function database(): Client {
      if (!client) throw new Error('[internal] numeric widening migration test database is not connected')
      return client
    }

    async function migrate(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<void> {
      const statements = captureSql(migrationClass, direction)
      await database().query('begin')
      try {
        for (const statement of statements) await database().query(statement)
        await database().query('commit')
      } catch (error) {
        await database().query('rollback')
        throw error
      }
    }

    function widenedColumns(entry: NumericWideningCase): WidenedColumn[] {
      return captureSql(entry.migration, 'up').flatMap((statement) => {
        const match = WIDEN_PATTERN.exec(statement)
        if (!match) return []
        const key = `${match[1]}.${match[2]}`
        return [{ table: match[1], column: match[2], legacy: entry.legacyOverrides?.[key] ?? entry.legacy }]
      })
    }

    function byTable(columns: WidenedColumn[]): Map<string, WidenedColumn[]> {
      const tables = new Map<string, WidenedColumn[]>()
      for (const column of columns) tables.set(column.table, [...(tables.get(column.table) ?? []), column])
      return tables
    }

    async function insertRow(table: string, id: number, values: Record<string, string | null>): Promise<void> {
      const columns = Object.keys(values)
      await database().query(
        `insert into "${table}" (id, ${columns.map((column) => `"${column}"`).join(', ')}) values ($1, ${columns.map((_, index) => `$${index + 2}::numeric`).join(', ')})`,
        [id, ...columns.map((column) => values[column])],
      )
    }

    async function readText(table: string, column: string, ids: number[]): Promise<Array<string | null>> {
      const result = await database().query<{ value: string | null }>(
        `select "${column}"::text as value from "${table}" where id = any($1::int[]) order by id`, [ids],
      )
      return result.rows.map((row) => row.value)
    }

    async function columnInfo(table: string, column: string): Promise<ColumnInfo | undefined> {
      const result = await database().query<ColumnInfo>(
        `select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable
         from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3`,
        [schema, table, column],
      )
      return result.rows[0]
    }

    async function expectColumnTypes(columns: WidenedColumn[], bounded: boolean): Promise<void> {
      for (const { table, column, legacy } of columns) {
        expect(await columnInfo(table, column)).toMatchObject({
          data_type: 'numeric',
          numeric_precision: bounded ? legacy.precision : null,
          numeric_scale: bounded ? legacy.scale : null,
        })
      }
    }

    beforeAll(async () => {
      const { GenericContainer, Wait } = await import('testcontainers')
      postgres = await new GenericContainer('postgres:16')
        .withEnvironment({ POSTGRES_DB: 'numeric_migration_test', POSTGRES_USER: 'numeric_test', POSTGRES_PASSWORD: 'numeric_test' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .withStartupTimeout(110_000)
        .start()
      client = new Client({
        host: postgres.getHost(),
        port: postgres.getMappedPort(5432),
        database: 'numeric_migration_test',
        user: 'numeric_test',
        password: 'numeric_test',
      })
      await client.connect()
    }, 120_000)

    beforeEach(async () => {
      schema = `numeric_migration_${randomUUID().replaceAll('-', '')}`
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
    }, 120_000)

    it.each(cases.map((entry) => [entry.migration.name, entry] as const))('%s widens bounded money columns without data loss and documents down() narrowing', async (_name, entry) => {
      const columns = widenedColumns(entry)
      const tables = byTable(columns)
      for (const [table, tableColumns] of tables) {
        const definitions = tableColumns.map(({ column, legacy }) => `"${column}" numeric(${legacy.precision},${legacy.scale})`)
        await database().query(`create table "${table}" (id int primary key, ${definitions.join(', ')})`)
        for (const [index, id] of LEGACY_ROW_IDS.entries()) {
          await insertRow(table, id, Object.fromEntries(tableColumns.map(({ column, legacy }) => [column, legacyFixtures(legacy)[index]])))
        }
      }
      const legacySnapshot = new Map<string, Array<string | null>>()
      for (const { table, column } of columns) legacySnapshot.set(`${table}.${column}`, await readText(table, column, LEGACY_ROW_IDS))
      await expectColumnTypes(columns, true)

      await migrate(entry.migration, 'up')
      await expectColumnTypes(columns, false)
      for (const { table, column } of columns) {
        expect(await readText(table, column, LEGACY_ROW_IDS)).toEqual(legacySnapshot.get(`${table}.${column}`))
      }
      for (const added of entry.addedColumns ?? []) {
        expect(await columnInfo(added.table, added.column)).toMatchObject({ data_type: added.dataType, is_nullable: 'YES' })
        const legacyMetadata = await database().query(`select "${added.column}" as value from "${added.table}" order by id`)
        expect(legacyMetadata.rows.map((row) => row.value)).toEqual(LEGACY_ROW_IDS.map(() => null))
        await database().query(`update "${added.table}" set "${added.column}" = $1 where id = 1`, [JSON.stringify(added.sample)])
        const stored = await database().query(`select "${added.column}" as value from "${added.table}" where id = 1`)
        expect(stored.rows[0].value).toEqual(added.sample)
      }

      expect(Number(BEYOND_FLOAT)).toBe(Number('0.1'))
      for (const [table, tableColumns] of tables) {
        await insertRow(table, 6, Object.fromEntries(tableColumns.map(({ column }) => [column, BEYOND_FLOAT])))
        await insertRow(table, 7, Object.fromEntries(tableColumns.map(({ column }) => [column, '0.1'])))
        await insertRow(table, 8, Object.fromEntries(tableColumns.map(({ column }) => [column, HUGE])))
        for (const { column } of tableColumns) {
          expect(await readText(table, column, [6, 7, 8])).toEqual([BEYOND_FLOAT, '0.1', HUGE])
          const equalToPointOne = await database().query<{ id: number }>(`select id from "${table}" where "${column}" = 0.1::numeric order by id`)
          expect(equalToPointOne.rows.map((row) => row.id)).toEqual([7])
        }
      }

      for (const table of tables.keys()) await database().query(`delete from "${table}" where id > 5`)
      await migrate(entry.migration, 'down')
      await expectColumnTypes(columns, true)
      for (const { table, column } of columns) {
        expect(await readText(table, column, LEGACY_ROW_IDS)).toEqual(legacySnapshot.get(`${table}.${column}`))
      }
      for (const added of entry.addedColumns ?? []) expect(await columnInfo(added.table, added.column)).toBeUndefined()

      await migrate(entry.migration, 'up')
      for (const [table, tableColumns] of tables) {
        for (const [offset, key] of [0, 1].entries()) {
          await insertRow(table, 10 + offset, Object.fromEntries(tableColumns.map(({ column, legacy }) => [column, roundedToLegacyScale(legacy)[key].input])))
        }
      }
      await migrate(entry.migration, 'down')
      await expectColumnTypes(columns, true)
      for (const { table, column, legacy } of columns) {
        expect(await readText(table, column, [10, 11])).toEqual(roundedToLegacyScale(legacy).map(({ expected }) => expected))
        expect(await readText(table, column, LEGACY_ROW_IDS)).toEqual(legacySnapshot.get(`${table}.${column}`))
      }

      await migrate(entry.migration, 'up')
      for (const [table, tableColumns] of tables) {
        await insertRow(table, 20, Object.fromEntries(tableColumns.map(({ column, legacy }) => [column, `1${'0'.repeat(legacy.precision - legacy.scale)}`])))
      }
      await expect(migrate(entry.migration, 'down')).rejects.toMatchObject({ code: '22003' })
      await expectColumnTypes(columns, false)
      for (const { table, column, legacy } of columns) {
        expect(await readText(table, column, [20])).toEqual([`1${'0'.repeat(legacy.precision - legacy.scale)}`])
      }
      for (const added of entry.addedColumns ?? []) {
        expect(await columnInfo(added.table, added.column)).toMatchObject({ data_type: added.dataType })
      }
    }, 60_000)
  })
}
