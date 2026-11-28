import { describe, expect, test } from '@jest/globals'
import { Migration20261122090000_customer_lookup_hashes } from '../Migration20261122090000_customer_lookup_hashes'

function collectSql(direction: 'up' | 'down'): string[] {
  const migration = Object.create(
    Migration20261122090000_customer_lookup_hashes.prototype,
  ) as Migration20261122090000_customer_lookup_hashes
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
  migration[direction]()
  return statements
}

describe('customer lookup hash migration', () => {
  test('adds nullable columns and non-unique scoped indexes without rewriting rows', () => {
    expect(collectSql('up')).toEqual([
      'alter table "customer_entities" add column "primary_email_hash" text null;',
      'create index "customer_entities_primary_email_hash_idx" on "customer_entities" ("tenant_id", "organization_id", "primary_email_hash");',
      'alter table "customer_companies" add column "domain_hash" text null;',
      'create index "customer_companies_domain_hash_idx" on "customer_companies" ("tenant_id", "organization_id", "domain_hash");',
    ])
  })

  test('removes the managed rules before dropping the new indexes and columns', () => {
    const [reconcileSql, ...schemaSql] = collectSql('down')
    expect(reconcileSql).toContain("rule - 'hashField'")
    expect(reconcileSql).toContain("'customers.seed-email-domain-hash-encryption-map'")
    expect(schemaSql).toEqual([
      'drop index "customer_companies_domain_hash_idx";',
      'alter table "customer_companies" drop column "domain_hash";',
      'drop index "customer_entities_primary_email_hash_idx";',
      'alter table "customer_entities" drop column "primary_email_hash";',
    ])
  })
})
