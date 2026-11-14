import { Migration20261109120000 } from '../Migration20261109120000'

function createMigration(): Migration20261109120000 {
  return new Migration20261109120000(undefined as any, undefined as any)
}

// Mirrors exactly what the migration itself hardcodes. Written literally (not
// imported from `../../encryption`) so this test keeps asserting the
// migration's own frozen contract even if the module's declared maps change
// later — see the migration's file-level comment for why.
const EXPECTED_MAPS = [
  {
    entityId: 'checkout:checkout_link_template',
    fields: ['gateway_settings'],
  },
  {
    entityId: 'checkout:checkout_link',
    fields: ['gateway_settings'],
  },
  {
    entityId: 'checkout:checkout_transaction',
    fields: [
      'customer_data',
      'first_name',
      'last_name',
      'email',
      'phone',
      'accepted_legal_consents',
      'ip_address',
    ],
  },
]

describe('Migration20261109120000 (checkout encryption map backfill)', () => {
  it('backfills every entity/field hardcoded in the migration', async () => {
    const migration = createMigration()
    await migration.up()
    const sql = migration.getQueries().join('\n')

    for (const map of EXPECTED_MAPS) {
      expect(sql).toContain(`'${map.entityId}'`)
      for (const field of map.fields) {
        expect(sql).toContain(`"field":"${field}"`)
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
