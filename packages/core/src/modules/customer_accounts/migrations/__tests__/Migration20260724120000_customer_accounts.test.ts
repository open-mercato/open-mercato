import { describe, expect, jest, test } from '@jest/globals'
import {
  Migration20260724120000_customer_accounts,
  buildRepairPoisonedCustomerEntityLinksSql,
} from '../Migration20260724120000_customer_accounts'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20260724120000_customer_accounts.prototype,
  ) as Migration20260724120000_customer_accounts
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('Migration20260724120000_customer_accounts', () => {
  test('up() emits exactly the shared repair SQL (single source of truth)', async () => {
    const statements = await collectSql('up')

    expect(statements).toHaveLength(1)
    expect(statements[0]).toBe(buildRepairPoisonedCustomerEntityLinksSql())
  })

  test('skips the repair when the customers tables are absent', async () => {
    // customer_accounts migrations run before customers ones (alphabetical
    // order in dbMigrate), so on a fresh database these tables do not exist.
    const sql = normalize(buildRepairPoisonedCustomerEntityLinksSql())

    // Asserted as one exact clause rather than loose fragments: a guard that
    // checks only one table, or that falls through into the update instead of
    // returning, must fail here.
    expect(sql).toContain(
      `if to_regclass('customer_entities') is null or to_regclass('customer_people') is null then return; end if;`,
    )
  })

  test('only touches rows whose FK is not an in-org, non-deleted company', async () => {
    const sql = normalize(buildRepairPoisonedCustomerEntityLinksSql())

    expect(sql).toContain('update "customer_users" cu')
    // A correct link is left alone — the update is gated on the NOT EXISTS of a
    // matching company, which also makes re-running the migration a no-op.
    expect(sql).toContain('where cu."customer_entity_id" is not null and not exists')
    expect(sql).toContain('where company."id" = cu."customer_entity_id"')
    expect(sql).toContain('and company."tenant_id" = cu."tenant_id"')
    expect(sql).toContain('and company."organization_id" = cu."organization_id"')
    expect(sql).toContain(`and company."kind" = 'company'`)
    expect(sql).toContain('and company."deleted_at" is null')
  })

  test('recovers the company only from an in-org person with an in-org company', async () => {
    const sql = normalize(buildRepairPoisonedCustomerEntityLinksSql())

    // The FK must resolve to a person in the user's OWN organization…
    expect(sql).toContain('where person."id" = cu."customer_entity_id"')
    expect(sql).toContain('and person."tenant_id" = cu."tenant_id"')
    expect(sql).toContain('and person."organization_id" = cu."organization_id"')
    expect(sql).toContain(`and person."kind" = 'person'`)
    expect(sql).toContain('and person."deleted_at" is null')
    // …the profile lookup stays inside that same scope…
    expect(sql).toContain('on profile."entity_id" = person."id"')
    expect(sql).toContain('and profile."tenant_id" = person."tenant_id"')
    expect(sql).toContain('and profile."organization_id" = person."organization_id"')
    // …and so does the recovered company, because it becomes the portal scope key.
    expect(sql).toContain('on company."id" = profile."company_entity_id"')
    expect(sql).toContain('and company."tenant_id" = person."tenant_id"')
    expect(sql).toContain('and company."organization_id" = person."organization_id"')
    // Deterministic pick if a person somehow carries more than one profile row.
    expect(sql).toContain('order by profile."created_at", profile."id" limit 1')
  })

  test('clears the FK when nothing can be recovered', async () => {
    const sql = normalize(buildRepairPoisonedCustomerEntityLinksSql())

    // The recovery is a scalar subquery: no in-org person, no in-org company, or
    // no profile at all all yield NULL, which is the intended clear. There is no
    // separate "set null" statement to keep the two branches from disagreeing.
    expect(sql).toContain('set "customer_entity_id" = ( select company."id"')
    expect(sql).not.toContain('set "customer_entity_id" = null')
  })

  test('bumps the optimistic-lock version on every repaired row', async () => {
    const sql = normalize(buildRepairPoisonedCustomerEntityLinksSql())

    // Without this a client holding the pre-repair updated_at could resubmit the
    // poisoned value and silently undo the fix instead of getting a 409.
    expect(sql).toContain('"updated_at" = now()')
  })

  test('is forward-only so a rollback cannot re-poison the column', async () => {
    const statements = await collectSql('down')

    expect(statements).toEqual([])
  })
})
