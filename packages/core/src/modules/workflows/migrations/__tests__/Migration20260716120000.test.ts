import { describe, expect, jest, test } from '@jest/globals'
import {
  Migration20260716120000,
  buildRetireSeededCheckoutDemoSql,
} from '../Migration20260716120000'

async function collectSql(direction: 'up' | 'down'): Promise<string> {
  const migration = Object.create(Migration20260716120000.prototype) as Migration20260716120000
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements[0]?.replace(/\s+/g, ' ').trim() ?? ''
}

describe('Migration20260716120000', () => {
  test('soft-deletes only the seeded checkout-demo rows (name/body agnostic)', async () => {
    const sql = await collectSql('up')

    expect(sql).toContain('set "deleted_at" = current_timestamp')
    expect(sql).toContain(`"wf"."workflow_id" = 'workflows.checkout-demo'`)
    // Never touches user customizations of the code definition…
    expect(sql).toContain(`"wf"."code_workflow_id" is null`)
    // …and stays idempotent.
    expect(sql).toContain(`"wf"."deleted_at" is null`)
    // Robust by construction: it does NOT fingerprint on workflow_name or the
    // create_order body, which is exactly why it covers every historical seed.
    expect(sql).not.toContain('workflow_name')
    expect(sql).not.toContain('create_order')
    expect(sql).not.toContain('lines')
  })

  test('up() emits exactly the shared retire SQL (single source of truth)', async () => {
    const emitted = await collectSql('up')
    const builder = buildRetireSeededCheckoutDemoSql().replace(/\s+/g, ' ').trim()

    expect(emitted).toBe(builder)
  })

  test('is forward-only so rollback cannot re-shadow the code definition', async () => {
    const migration = Object.create(Migration20260716120000.prototype) as Migration20260716120000
    const addSql = jest.fn()
    Object.defineProperty(migration, 'addSql', { value: addSql })

    await migration.down()

    expect(addSql).not.toHaveBeenCalled()
  })
})
