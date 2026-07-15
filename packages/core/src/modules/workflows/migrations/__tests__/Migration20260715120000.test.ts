import { describe, expect, jest, test } from '@jest/globals'
import { Migration20260715120000 } from '../Migration20260715120000'

async function collectSql(direction: 'up' | 'down'): Promise<string> {
  const migration = Object.create(Migration20260715120000.prototype) as Migration20260715120000
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  expect(statements).toHaveLength(1)
  return statements[0].replace(/\s+/g, ' ').trim()
}

describe('Migration20260715120000', () => {
  test('sanitizes only the known legacy checkout seed while preserving its row', async () => {
    const sql = await collectSql('up')

    expect(sql).toContain('set "definition" = jsonb_set(')
    expect(sql).toContain(`then "transition"."value" - 'activities'`)
    expect(sql).toContain(`'cart_to_customer_info'`)
    expect(sql).toContain(`'customer_info_to_payment'`)
    expect(sql).toContain(`'confirmation_to_order'`)
    expect(sql).toContain(`"wf"."workflow_id" = 'workflows.checkout-demo'`)
    expect(sql).toContain(`"wf"."workflow_name" = 'Checkout with Payment Webhook'`)
    expect(sql).toContain('"wf"."version" = 1')
    expect(sql).toContain(`"activity"."value"->>'activityId' = 'reserve_inventory'`)
    expect(sql).toContain(`"activity"."value"->>'activityType' = 'CALL_WEBHOOK'`)
    expect(sql).toContain(
      `"activity"."value"#>>'{config,url}' = '{{env.INVENTORY_SERVICE_URL}}/api/inventory/reserve'`,
    )
    expect(sql).not.toContain('set "deleted_at"')
  })

  test('is forward-only so rollback cannot restore obsolete external webhooks', async () => {
    const migration = Object.create(Migration20260715120000.prototype) as Migration20260715120000
    const addSql = jest.fn()
    Object.defineProperty(migration, 'addSql', { value: addSql })

    await migration.down()

    expect(addSql).not.toHaveBeenCalled()
  })
})
