import { expect, test } from '@playwright/test'
import {
  deleteWorkflowDefinitions,
  getWorkflowDefinition,
  runLegacyCheckoutRepair,
  seedWorkflowDefinition,
} from './helpers/db'

/**
 * TC-WF-031: Checkout-demo repair migration transforms only the known legacy seed.
 *
 * Guards issue #4179 at the data layer. `Migration20260715120000` is pure jsonb
 * surgery; TC-WF-030 exercises the maintained code definition end-to-end but not
 * the migration's SQL. This spec seeds a legacy-shaped `workflow_definitions`
 * row (plus control rows that MUST stay untouched), runs the migration's exact
 * exported SQL against Postgres, and asserts the resulting `definition`.
 *
 * ENVIRONMENT: DB-level fixtures (raw `pg` against `DATABASE_URL`). Run under a
 * coherent app+DB stack (`yarn test:integration`).
 */

const LEGACY_ACTIVITY_URL = '{{env.INVENTORY_SERVICE_URL}}/api/inventory/reserve'
const PAYMENT_ACTIVITY_URL = '{{env.PAYMENT_SERVICE_URL}}/api/payments/charge'

const STRIPPED_TRANSITIONS = ['cart_to_customer_info', 'customer_info_to_payment', 'confirmation_to_order']
const PRESERVED_WITH_ACTIVITIES = ['start_to_cart', 'payment_to_wait_confirmation', 'confirmation_to_end']

type Transition = {
  transitionId: string
  activities?: Array<Record<string, unknown>>
  preConditions?: Array<Record<string, unknown>>
}

/** Faithful shape of the original seeded checkout definition (examples/checkout-demo-definition.json). */
function legacyCheckoutDefinition(overrides?: { inventoryUrl?: string }): Record<string, unknown> {
  const inventoryUrl = overrides?.inventoryUrl ?? LEGACY_ACTIVITY_URL
  const transitions: Transition[] = [
    { transitionId: 'start_to_cart', activities: [{ activityId: 'log_checkout_start', activityType: 'EMIT_EVENT' }] },
    {
      transitionId: 'cart_to_customer_info',
      preConditions: [{ ruleId: 'workflow_checkout_cart_not_empty', required: true }],
      activities: [
        { activityId: 'validate_cart_items', activityType: 'EMIT_EVENT' },
        { activityId: 'reserve_inventory', activityType: 'CALL_WEBHOOK', config: { url: inventoryUrl } },
        { activityId: 'emit_cart_validated', activityType: 'EMIT_EVENT' },
      ],
    },
    {
      transitionId: 'customer_info_to_payment',
      activities: [
        { activityId: 'charge_payment', activityType: 'CALL_WEBHOOK', config: { url: PAYMENT_ACTIVITY_URL } },
        { activityId: 'log_payment_initiated', activityType: 'EMIT_EVENT' },
      ],
    },
    { transitionId: 'payment_to_wait_confirmation', activities: [] },
    {
      transitionId: 'confirmation_to_order',
      activities: [
        { activityId: 'update_payment_status', activityType: 'EMIT_EVENT' },
        { activityId: 'emit_payment_success', activityType: 'EMIT_EVENT' },
      ],
    },
    {
      transitionId: 'confirmation_to_end',
      activities: [
        { activityId: 'create_order', activityType: 'CALL_API' },
        { activityId: 'send_confirmation_email', activityType: 'SEND_EMAIL' },
        { activityId: 'emit_order_completed', activityType: 'EMIT_EVENT' },
      ],
    },
  ]
  return { steps: [], transitions }
}

function transitionsOf(definition: Record<string, unknown> | null): Transition[] {
  return (definition?.transitions as Transition[]) ?? []
}

function byId(definition: Record<string, unknown> | null): Map<string, Transition> {
  return new Map(transitionsOf(definition).map((transition) => [transition.transitionId, transition]))
}

test.describe('TC-WF-031: checkout-demo repair migration', () => {
  test('strips only the three legacy transitions and leaves control rows untouched', async () => {
    const seededIds: Array<string | null> = []
    try {
      const target = await seedWorkflowDefinition({ definition: legacyCheckoutDefinition() })
      const codeOverride = await seedWorkflowDefinition({
        codeWorkflowId: 'workflows.checkout-demo',
        definition: legacyCheckoutDefinition(),
      })
      const differentUrl = await seedWorkflowDefinition({
        definition: legacyCheckoutDefinition({ inventoryUrl: 'https://example.com/reserve' }),
      })
      const wrongVersion = await seedWorkflowDefinition({ version: 2, definition: legacyCheckoutDefinition() })
      const softDeleted = await seedWorkflowDefinition({ softDeleted: true, definition: legacyCheckoutDefinition() })
      seededIds.push(target.id, codeOverride.id, differentUrl.id, wrongVersion.id, softDeleted.id)

      await runLegacyCheckoutRepair()

      // Target: the three transitions lose their activities, everything else is preserved.
      const repaired = await getWorkflowDefinition(target.id)
      const repairedById = byId(repaired)

      expect(
        transitionsOf(repaired).map((transition) => transition.transitionId),
        'transition order is preserved',
      ).toEqual([
        'start_to_cart',
        'cart_to_customer_info',
        'customer_info_to_payment',
        'payment_to_wait_confirmation',
        'confirmation_to_order',
        'confirmation_to_end',
      ])

      for (const transitionId of STRIPPED_TRANSITIONS) {
        expect(repairedById.get(transitionId), `${transitionId} exists`).toBeTruthy()
        expect(
          Object.prototype.hasOwnProperty.call(repairedById.get(transitionId)!, 'activities'),
          `${transitionId} loses its activities key`,
        ).toBe(false)
      }

      // preConditions on a stripped transition survive — only `activities` is removed.
      expect(repairedById.get('cart_to_customer_info')!.preConditions, 'preConditions preserved').toHaveLength(1)

      for (const transitionId of PRESERVED_WITH_ACTIVITIES) {
        expect(
          Object.prototype.hasOwnProperty.call(repairedById.get(transitionId)!, 'activities'),
          `${transitionId} keeps its activities key`,
        ).toBe(true)
      }
      // confirmation_to_end retains all three internal (non-webhook) activities.
      expect(repairedById.get('confirmation_to_end')!.activities, 'confirmation_to_end kept intact').toHaveLength(3)
      // No obsolete external webhook survives on the repaired row.
      const repairedJson = JSON.stringify(repaired)
      expect(repairedJson).not.toContain(LEGACY_ACTIVITY_URL)
      expect(repairedJson).not.toContain(PAYMENT_ACTIVITY_URL)

      // Control rows: none of the guards may be crossed.
      for (const control of [codeOverride, differentUrl, wrongVersion, softDeleted]) {
        const untouched = byId(await getWorkflowDefinition(control.id))
        for (const transitionId of STRIPPED_TRANSITIONS) {
          expect(
            Object.prototype.hasOwnProperty.call(untouched.get(transitionId)!, 'activities'),
            `control row ${control.id} keeps ${transitionId} activities`,
          ).toBe(true)
        }
      }

      // Idempotency: once reserve_inventory is gone the predicate no longer
      // matches, so replaying the repair must be a no-op.
      await runLegacyCheckoutRepair()
      expect(await getWorkflowDefinition(target.id), 'second repair run is a no-op').toEqual(repaired)
    } finally {
      await deleteWorkflowDefinitions(seededIds).catch(() => undefined)
    }
  })
})
