import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EntitySchema } from '@mikro-orm/core'
import { Migrator } from '@mikro-orm/migrations'
import { MikroORM } from '@mikro-orm/postgresql'
import { ExactDecimalType } from '@open-mercato/shared/lib/db/exactDecimalType'
import { preserveUnconstrainedNumericSnapshots } from '../numeric-snapshots'

class SnapshotProbeMigrator extends Migrator {
  writeSnapshot() {
    return this.storeCurrentSchema()
  }
}

describe('unconstrained numeric migration snapshots', () => {
  let orm: MikroORM
  let migrationsPath: string

  beforeAll(async () => {
    migrationsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'numeric-snapshots-'))
    orm = await MikroORM.init({
      entities: [new EntitySchema({
        name: 'NumericSnapshotProbe',
        tableName: 'numeric_snapshot_probes',
        properties: {
          id: { type: 'uuid', primary: true },
          amount: { type: ExactDecimalType, columnType: 'numeric' },
          rate: { type: ExactDecimalType },
          percentage: { type: 'decimal', precision: 7, scale: 4 },
        },
      })],
      dbName: 'numeric_snapshot_probe',
      connect: false,
      extensions: [Migrator],
      migrations: {
        path: migrationsPath,
        pathTs: migrationsPath,
        snapshotName: '.snapshot-probe',
      },
    })
    preserveUnconstrainedNumericSnapshots(orm.em.getDriver().getPlatform())
  })

  afterAll(async () => {
    await orm?.close(true)
    if (migrationsPath) fs.rmSync(migrationsPath, { recursive: true, force: true })
  })

  it('preserves bare numeric aliases and delegates bounded and other types', () => {
    const platform = orm.em.getDriver().getPlatform()

    expect(platform.normalizeColumnType('numeric', {})).toBe('numeric')
    expect(platform.normalizeColumnType('decimal', {})).toBe('numeric')
    expect(platform.normalizeColumnType('numeric', { precision: 7, scale: 4 })).toBe('numeric(7,4)')
    expect(platform.normalizeColumnType('numeric(7,4)', { precision: 7, scale: 4 })).toBe('numeric(7,4)')
    expect(platform.normalizeColumnType('numeric', { precision: 7 })).toBe('numeric(7,0)')
    expect(platform.normalizeColumnType('numeric', { scale: 4 })).toBe('numeric(10,4)')
    expect(platform.normalizeColumnType('integer', {})).toBe('int')
    expect(platform.normalizeColumnType('varchar', { length: 50 })).toBe('varchar(50)')
  })

  it('writes actual numeric snapshot columns and produces no migration on repeated generation', async () => {
    const migrator = new SnapshotProbeMigrator(orm.em)
    await migrator.writeSnapshot()

    const snapshot: {
      tables: { columns: Record<string, { type: string; precision: number | null; scale: number | null }> }[]
    } = JSON.parse(fs.readFileSync(path.join(migrationsPath, '.snapshot-probe.json'), 'utf8'))
    const columns = snapshot.tables[0].columns

    expect(columns.amount).toMatchObject({ type: 'numeric', precision: null, scale: null })
    expect(columns.rate).toMatchObject({ type: 'numeric', precision: null, scale: null })
    expect(columns.percentage).toMatchObject({ type: 'numeric(7,4)', precision: 7, scale: 4 })
    expect(await orm.migrator.create()).toMatchObject({ fileName: '', diff: { up: [], down: [] } })
    expect(await orm.migrator.create()).toMatchObject({ fileName: '', diff: { up: [], down: [] } })
    expect(fs.readdirSync(migrationsPath)).toEqual(['.snapshot-probe.json'])
  })
})
