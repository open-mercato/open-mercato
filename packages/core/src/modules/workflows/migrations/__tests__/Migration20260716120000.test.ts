import { describe, expect, jest, test } from '@jest/globals'
import {
  Migration20260716120000,
  buildCheckoutOrderLinesRepairSql,
  legacyCheckoutOrderLinesPredicate,
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
  test('injects the cart order lines only into the legacy checkout create_order body', async () => {
    const sql = await collectSql('up')

    expect(sql).toContain('set "definition" = jsonb_set(')
    // Targets the confirmation_to_end transition and the create_order CALL_API activity
    expect(sql).toContain(`"transition"."value"->>'transitionId' = 'confirmation_to_end'`)
    expect(sql).toContain(`"activity"."value"->>'activityId' = 'create_order'`)
    expect(sql).toContain(`"activity"."value"->>'activityType' = 'CALL_API'`)
    // Writes lines into config.body without disturbing the rest of the body
    expect(sql).toContain(`'{config,body,lines}'`)
    expect(sql).toContain(`'"{{context.cart.orderLines}}"'::jsonb`)
    // Row fingerprint
    expect(sql).toContain(`"wf"."workflow_id" = 'workflows.checkout-demo'`)
    expect(sql).toContain(`"wf"."workflow_name" = 'Checkout with Payment Webhook'`)
    expect(sql).toContain('"wf"."version" = 1')
    expect(sql).toContain(`"wf"."code_workflow_id" is null`)
    // Never soft-deletes or otherwise mutates the row lifecycle
    expect(sql).not.toContain('set "deleted_at"')
  })

  test('is idempotent: only matches rows whose create_order body still lacks lines', async () => {
    const predicate = legacyCheckoutOrderLinesPredicate().replace(/\s+/g, ' ').trim()

    expect(predicate).toContain(`"activity"."value" #> '{config,body,lines}' is null`)
    expect(predicate).toContain(`"activity"."value" #> '{config,body}' is not null`)
  })

  test('up() emits exactly the shared repair SQL (single source of truth)', async () => {
    const emitted = await collectSql('up')
    const builder = buildCheckoutOrderLinesRepairSql().replace(/\s+/g, ' ').trim()

    expect(emitted).toBe(builder)
  })

  test('is forward-only so rollback cannot re-introduce zero-line orders', async () => {
    const migration = Object.create(Migration20260716120000.prototype) as Migration20260716120000
    const addSql = jest.fn()
    Object.defineProperty(migration, 'addSql', { value: addSql })

    await migration.down()

    expect(addSql).not.toHaveBeenCalled()
  })
})
