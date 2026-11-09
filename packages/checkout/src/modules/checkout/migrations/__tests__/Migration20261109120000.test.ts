import { Migration20261109120000 } from '../Migration20261109120000'
import { defaultEncryptionMaps } from '../../encryption'

function createMigration(): Migration20261109120000 {
  return new Migration20261109120000(undefined as any, undefined as any)
}

describe('Migration20261109120000 (checkout encryption map backfill)', () => {
  it('backfills every entity/field declared in defaultEncryptionMaps', async () => {
    const migration = createMigration()
    await migration.up()
    const sql = migration.getQueries().join('\n')

    expect(defaultEncryptionMaps.length).toBeGreaterThan(0)
    for (const map of defaultEncryptionMaps) {
      expect(sql).toContain(`'${map.entityId}'`)
      for (const rule of map.fields) {
        expect(sql).toContain(`"field":"${rule.field}"`)
      }
    }
  })

  it('guards the insert against pre-existing rows and a missing encryption_maps table', async () => {
    const migration = createMigration()
    await migration.up()
    const sql = migration.getQueries().join('\n')

    expect(sql).toContain("to_regclass('encryption_maps') is null")
    expect(sql).toContain('not exists')
  })

  it('leaves down() empty so existing admin-edited or tenant-seeded maps are never deleted', async () => {
    const migration = createMigration()
    await migration.down()

    expect(migration.getQueries()).toEqual([])
  })
})
