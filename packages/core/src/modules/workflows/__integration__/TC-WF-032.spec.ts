import { expect, test } from '@playwright/test'
import {
  deleteWorkflowDefinitions,
  getWorkflowDefinition,
  runCheckoutOrderLinesRepair,
  seedWorkflowDefinition,
} from './helpers/db'

/**
 * TC-WF-032: Checkout-demo create_order line-items repair migration (#4211).
 *
 * `Migration20260716120000` is pure jsonb surgery: it back-fills
 * `lines: '{{context.cart.orderLines}}'` into the persisted legacy checkout
 * definition's `create_order` CALL_API body so orders created by the DB-first
 * definition carry their cart line items (and therefore non-zero totals). This
 * spec seeds a legacy-shaped `workflow_definitions` row (plus control rows that
 * MUST stay untouched), runs the migration's exact exported SQL against
 * Postgres, and asserts the resulting `definition`.
 *
 * ENVIRONMENT: DB-level fixtures (raw `pg` against `DATABASE_URL`). Run under a
 * coherent app+DB stack (`yarn test:integration`).
 */

type Activity = { activityId: string; activityType: string; config?: Record<string, any> }
type Transition = { transitionId: string; activities?: Activity[] }

/**
 * Faithful shape of the original seeded checkout definition's order transition,
 * whose create_order body carried header/total fields but no `lines`.
 */
function legacyCheckoutDefinition(overrides?: { withLines?: boolean }): Record<string, unknown> {
  const createOrderBody: Record<string, unknown> = {
    customerEntityId: '{{context.customer.id}}',
    currencyCode: '{{context.cart.currency}}',
    placedAt: '{{now}}',
    grandTotalGrossAmount: '{{context.cart.total}}',
    subtotalGrossAmount: '{{context.cart.subtotal}}',
    taxTotalAmount: '{{context.cart.tax}}',
    shippingGrossAmount: '{{context.cart.shipping}}',
    lineItemCount: '{{context.cart.itemCount}}',
  }
  if (overrides?.withLines) createOrderBody.lines = '{{context.cart.orderLines}}'

  const transitions: Transition[] = [
    { transitionId: 'start_to_cart', activities: [{ activityId: 'log_checkout_start', activityType: 'EMIT_EVENT' }] },
    { transitionId: 'payment_to_wait_confirmation', activities: [] },
    {
      transitionId: 'confirmation_to_end',
      activities: [
        {
          activityId: 'create_order',
          activityType: 'CALL_API',
          config: { endpoint: '/api/sales/orders', method: 'POST', body: createOrderBody, validateTenantMatch: true },
        },
        { activityId: 'send_confirmation_email', activityType: 'SEND_EMAIL', config: { to: '{{context.customer.email}}' } },
      ],
    },
  ]
  return { steps: [], transitions }
}

function transitionsOf(definition: Record<string, unknown> | null): Transition[] {
  return (definition?.transitions as Transition[]) ?? []
}

function createOrderBodyOf(definition: Record<string, unknown> | null): Record<string, any> | undefined {
  const orderTransition = transitionsOf(definition).find((transition) => transition.transitionId === 'confirmation_to_end')
  const createOrder = orderTransition?.activities?.find((activity) => activity.activityId === 'create_order')
  return createOrder?.config?.body
}

test.describe('TC-WF-032: checkout-demo order line-items repair migration', () => {
  test('back-fills create_order lines only on the known legacy seed, idempotently', async () => {
    const seededIds: Array<string | null> = []
    try {
      const target = await seedWorkflowDefinition({ definition: legacyCheckoutDefinition() })
      const codeOverride = await seedWorkflowDefinition({
        codeWorkflowId: 'workflows.checkout-demo',
        definition: legacyCheckoutDefinition(),
      })
      const wrongVersion = await seedWorkflowDefinition({ version: 2, definition: legacyCheckoutDefinition() })
      const softDeleted = await seedWorkflowDefinition({ softDeleted: true, definition: legacyCheckoutDefinition() })
      const alreadyFixed = await seedWorkflowDefinition({ definition: legacyCheckoutDefinition({ withLines: true }) })
      seededIds.push(target.id, codeOverride.id, wrongVersion.id, softDeleted.id, alreadyFixed.id)

      await runCheckoutOrderLinesRepair()

      // Target: create_order body gains `lines` while every other field is preserved verbatim.
      const repaired = await getWorkflowDefinition(target.id)
      const repairedBody = createOrderBodyOf(repaired)
      expect(repairedBody?.lines, 'cart order lines are wired into create_order').toBe('{{context.cart.orderLines}}')
      expect(repairedBody?.grandTotalGrossAmount, 'existing total fields preserved').toBe('{{context.cart.total}}')
      expect(repairedBody?.subtotalGrossAmount, 'existing subtotal preserved').toBe('{{context.cart.subtotal}}')
      // Transition order and unrelated activities/transitions are untouched.
      expect(
        transitionsOf(repaired).map((transition) => transition.transitionId),
        'transition order preserved',
      ).toEqual(['start_to_cart', 'payment_to_wait_confirmation', 'confirmation_to_end'])
      const orderActivities = transitionsOf(repaired).find((t) => t.transitionId === 'confirmation_to_end')?.activities
      expect(orderActivities, 'sibling activities preserved').toHaveLength(2)
      expect(
        orderActivities?.find((activity) => activity.activityId === 'send_confirmation_email'),
        'send_confirmation_email untouched',
      ).toBeTruthy()

      // Control rows: none of the guards may be crossed.
      for (const control of [codeOverride, wrongVersion, softDeleted]) {
        const untouched = await getWorkflowDefinition(control.id)
        expect(createOrderBodyOf(untouched)?.lines, `control row ${control.id} not modified`).toBeUndefined()
      }

      // Idempotency: a row that already has lines is left byte-for-byte identical,
      // and replaying the repair on the target is a no-op.
      const alreadyFixedBefore = await getWorkflowDefinition(alreadyFixed.id)
      await runCheckoutOrderLinesRepair()
      expect(await getWorkflowDefinition(alreadyFixed.id), 'pre-fixed row untouched').toEqual(alreadyFixedBefore)
      expect(await getWorkflowDefinition(target.id), 'second repair run is a no-op').toEqual(repaired)
    } finally {
      await deleteWorkflowDefinitions(seededIds).catch(() => undefined)
    }
  })
})
