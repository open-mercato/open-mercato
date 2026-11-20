import { buildEncryptionMapBackfillSql } from '../migration-backfill'

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('buildEncryptionMapBackfillSql', () => {
  test('emits a single table-guarded block that inserts missing maps for active scopes', () => {
    const sql = normalize(buildEncryptionMapBackfillSql({ entityId: 'demo:thing', fields: [{ field: 'secret' }] }))

    expect(sql.startsWith('do $$ begin if to_regclass(\'encryption_maps\') is null then return; end if;')).toBe(true)
    expect(sql.endsWith('end $$;')).toBe(true)
    expect(sql).toContain(
      `select gen_random_uuid(), 'demo:thing', src."tenant_id", src."organization_id", '[{"field":"secret"}]'::jsonb, true, now(), now()`,
    )
    expect(sql).toContain('where "is_active" = true and "deleted_at" is null')
    expect(sql).toContain(`where existing."entity_id" = 'demo:thing'`)
  })

  test('appends each missing field rule to existing maps without replacing other rules', () => {
    const sql = normalize(
      buildEncryptionMapBackfillSql({
        entityId: 'demo:thing',
        fields: [{ field: 'secret' }, { field: 'email', hashField: 'email_hash' }],
      }),
    )

    expect(sql).toContain(`'[{"field":"secret"},{"field":"email","hashField":"email_hash"}]'::jsonb`)
    expect(sql).toContain(`coalesce("fields_json", '[]'::jsonb) || '[{"field":"secret"}]'::jsonb`)
    expect(sql).toContain(`coalesce("fields_json", '[]'::jsonb) || '[{"field":"email","hashField":"email_hash"}]'::jsonb`)
    expect(sql).toContain(`where rule->>'field' = 'secret'`)
    expect(sql).toContain(`where rule->>'field' = 'email'`)
  })

  test('deduplicates repeated field rules', () => {
    const sql = buildEncryptionMapBackfillSql({ entityId: 'demo:thing', fields: [{ field: 'secret' }, { field: 'secret' }] })

    expect(sql.match(/update "encryption_maps"/g)).toHaveLength(1)
    expect(sql).toContain(`'[{"field":"secret"}]'::jsonb, true`)
  })

  test.each([
    ['entity id with a quote', { entityId: "demo:thing'; drop table x; --", fields: [{ field: 'secret' }] }],
    ['entity id without module prefix', { entityId: 'thing', fields: [{ field: 'secret' }] }],
    ['field with a quote', { entityId: 'demo:thing', fields: [{ field: "secret'" }] }],
    ['hash field with a quote', { entityId: 'demo:thing', fields: [{ field: 'email', hashField: "x'" }] }],
    ['no fields', { entityId: 'demo:thing', fields: [] }],
  ])('rejects %s', (_label, map) => {
    expect(() => buildEncryptionMapBackfillSql(map)).toThrow('[internal]')
  })

  test('rejects system-scoped maps, which never live in encryption_maps', () => {
    expect(() =>
      buildEncryptionMapBackfillSql({ entityId: 'demo:thing', keyScope: 'system', fields: [{ field: 'secret' }] }),
    ).toThrow('system-scoped')
  })
})
