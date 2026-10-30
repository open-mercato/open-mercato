import {
  checkEncryptionMapBackfills,
  findEncryptionBackfillGaps,
  formatEncryptionBackfillWarning,
  isBackfilledByMigration,
  isEncryptionBackfillCheckEnabled,
  readDeclaredEncryptionMaps,
  type EncryptionMapRow,
} from '../encryption-backfill-check'

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'
const ORG = '33333333-3333-3333-3333-333333333333'

function row(tenantId: string, entityId: string, fields: string[], isActive = true): EncryptionMapRow {
  return { tenantId, organizationId: ORG, entityId, fieldsJson: fields.map((field) => ({ field })), isActive }
}

describe('readDeclaredEncryptionMaps', () => {
  it('reads defaultEncryptionMaps and skips system-scoped or malformed entries', () => {
    const declared = readDeclaredEncryptionMaps('demo', {
      defaultEncryptionMaps: [
        { entityId: 'demo:thing', fields: [{ field: 'secret' }, { field: 'email', hashField: 'email_hash' }] },
        { entityId: 'demo:system', keyScope: 'system', fields: [{ field: 'token' }] },
        { entityId: 'demo:empty', fields: [] },
        { fields: [{ field: 'orphan' }] },
      ],
    })

    expect(declared).toEqual([{ moduleId: 'demo', entityId: 'demo:thing', fields: ['secret', 'email'] }])
  })

  it('falls back to the default export', () => {
    expect(readDeclaredEncryptionMaps('demo', { default: [{ entityId: 'demo:thing', fields: [{ field: 'secret' }] }] }))
      .toEqual([{ moduleId: 'demo', entityId: 'demo:thing', fields: ['secret'] }])
  })
})

describe('isBackfilledByMigration', () => {
  it('accepts a helper call or raw encryption_maps SQL naming the entity and field', () => {
    const helperSource = `buildEncryptionMapBackfillSql({ entityId: 'demo:thing', fields: [{ field: 'secret' }] })`
    const rawSource = `insert into "encryption_maps" select 'demo:thing', '[{"field":"secret"}]'::jsonb`

    expect(isBackfilledByMigration([helperSource], 'demo:thing', 'secret')).toBe(true)
    expect(isBackfilledByMigration([rawSource], 'demo:thing', 'secret')).toBe(true)
  })

  it('rejects migrations that do not write encryption maps or name another field', () => {
    expect(isBackfilledByMigration([`alter table demo add column "secret" text; -- demo:thing`], 'demo:thing', 'secret')).toBe(false)
    expect(isBackfilledByMigration([`buildEncryptionMapBackfillSql({ entityId: 'demo:thing', fields: [{ field: 'secret_hash' }] })`], 'demo:thing', 'secret')).toBe(false)
  })
})

describe('findEncryptionBackfillGaps', () => {
  const declared = [{ moduleId: 'demo', entityId: 'demo:thing', fields: ['secret', 'email'] }]

  it('reports declared fields missing for existing encryption-enabled scopes', () => {
    const gaps = findEncryptionBackfillGaps({
      declared,
      rows: [row(TENANT_A, 'other:x', ['a']), row(TENANT_B, 'demo:thing', ['secret', 'email'])],
      migrationSources: [],
    })

    expect(gaps).toEqual([
      { moduleId: 'demo', entityId: 'demo:thing', field: 'secret', missingScopes: 1, totalScopes: 2 },
      { moduleId: 'demo', entityId: 'demo:thing', field: 'email', missingScopes: 1, totalScopes: 2 },
    ])
  })

  it('reports a new field on an existing map', () => {
    const gaps = findEncryptionBackfillGaps({ declared, rows: [row(TENANT_A, 'demo:thing', ['secret'])], migrationSources: [] })

    expect(gaps.map((gap) => gap.field)).toEqual(['email'])
  })

  it('ignores scopes with encryption disabled and fields a migration backfills', () => {
    expect(findEncryptionBackfillGaps({ declared, rows: [row(TENANT_A, 'other:x', ['a'], false)], migrationSources: [] })).toEqual([])
    expect(
      findEncryptionBackfillGaps({
        declared,
        rows: [row(TENANT_A, 'other:x', ['a'])],
        migrationSources: [`buildEncryptionMapBackfillSql({ entityId: 'demo:thing', fields: [{ field: 'secret' }, { field: 'email' }] })`],
      }),
    ).toEqual([])
  })
})

describe('checkEncryptionMapBackfills', () => {
  it('warns once with every gap', async () => {
    const warn = jest.fn()
    const gaps = await checkEncryptionMapBackfills({
      loadDeclaredMaps: async () => [{ moduleId: 'demo', entityId: 'demo:thing', fields: ['secret'] }],
      loadMigrationSources: () => [],
      queryEncryptionMaps: async () => [row(TENANT_A, 'other:x', ['a'])],
      warn,
    })

    expect(gaps).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('demo: demo:thing [secret] (missing in 1/1 tenant scopes)')
    expect(warn.mock.calls[0][0]).toContain('buildEncryptionMapBackfillSql')
  })

  it('does not query the database when no module declares maps', async () => {
    const queryEncryptionMaps = jest.fn(async () => [])
    await checkEncryptionMapBackfills({ loadDeclaredMaps: async () => [], loadMigrationSources: () => [], queryEncryptionMaps, warn: jest.fn() })

    expect(queryEncryptionMaps).not.toHaveBeenCalled()
  })

  it('turns failures into a warning instead of throwing', async () => {
    const warn = jest.fn()
    const gaps = await checkEncryptionMapBackfills({
      loadDeclaredMaps: async () => [{ moduleId: 'demo', entityId: 'demo:thing', fields: ['secret'] }],
      loadMigrationSources: () => [],
      queryEncryptionMaps: async () => {
        throw new Error('connection refused')
      },
      warn,
    })

    expect(gaps).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })
})

describe('formatEncryptionBackfillWarning', () => {
  it('groups fields per entity and caps the list', () => {
    const gaps = Array.from({ length: 22 }, (_unused, index) => [
      { moduleId: 'demo', entityId: `demo:thing_${index}`, field: 'secret', missingScopes: 1, totalScopes: 2 },
      { moduleId: 'demo', entityId: `demo:thing_${index}`, field: 'email', missingScopes: 2, totalScopes: 2 },
    ]).flat()
    const message = formatEncryptionBackfillWarning(gaps)

    expect(message).toContain('   - demo: demo:thing_0 [secret, email] (missing in 2/2 tenant scopes)')
    expect(message).not.toContain('demo:thing_20 ')
    expect(message).toContain('… and 2 more entities')
  })
})

describe('isEncryptionBackfillCheckEnabled', () => {
  it('is on by default and can be switched off', () => {
    expect(isEncryptionBackfillCheckEnabled({})).toBe(true)
    expect(isEncryptionBackfillCheckEnabled({ OM_ENCRYPTION_BACKFILL_CHECK: 'off' })).toBe(false)
  })
})
