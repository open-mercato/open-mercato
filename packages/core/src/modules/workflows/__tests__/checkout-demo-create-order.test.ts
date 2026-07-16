import { describe, expect, test } from '@jest/globals'
import { workflowsConfig } from '../workflows'

/**
 * Guards issue #4211: the code-defined checkout demo must forward the cart's
 * line items to the sales-order API. Without `lines` the order is created with
 * zero line items and — because the create command recomputes totals from the
 * persisted lines — $0.00 totals. Fresh installs execute this virtual code
 * definition directly (find-definition.ts), so this is the primary regression
 * guard; the migration specs cover legacy persisted rows.
 */
describe('checkout-demo create_order activity', () => {
  const checkout = workflowsConfig.workflows.find((wf) => wf.workflowId === 'workflows.checkout-demo')
  const orderTransition = checkout?.definition.transitions.find((t) => t.transitionId === 'confirmation_to_end')
  const createOrder = orderTransition?.activities?.find((a) => a.activityId === 'create_order')
  const body = (createOrder?.config as { body?: Record<string, unknown> } | undefined)?.body

  test('posts to the sales orders API', () => {
    expect(createOrder?.activityType).toBe('CALL_API')
    expect((createOrder?.config as { endpoint?: string }).endpoint).toBe('/api/sales/orders')
  })

  test('forwards the cart order lines so the order is not created empty', () => {
    expect(body?.lines).toBe('{{context.cart.orderLines}}')
  })
})
