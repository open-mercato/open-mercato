import { expect, test } from '@playwright/test'
import {
  deleteWorkflowDefinitions,
  isWorkflowDefinitionSoftDeleted,
  runRetireSeededCheckoutDemo,
  seedWorkflowDefinition,
} from './helpers/db'

/**
 * TC-WF-032: retire the shadowing checkout-demo seed rows (#4211).
 *
 * `Migration20260716120000` soft-deletes the persisted `workflows.checkout-demo`
 * seed rows so runtime falls through to the maintained code definition (the only
 * one that forwards cart line items + shipping/tax adjustments to the sales-order
 * API). The repair is deliberately name/body-agnostic: it must retire every
 * historical seed variant — including the earlier `Simple Checkout Flow` name a
 * body/name fingerprint would have missed — while never touching a user's
 * customization of the code definition (`code_workflow_id` set).
 *
 * ENVIRONMENT: DB-level fixtures (raw `pg` against `DATABASE_URL`). Run under a
 * coherent app+DB stack (`yarn test:integration`).
 */

function checkoutSeed(overrides?: { withoutLines?: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    customerEntityId: '{{context.customer.id}}',
    currencyCode: '{{context.cart.currency}}',
    placedAt: '{{now}}',
  }
  if (!overrides?.withoutLines) body.lines = '{{context.cart.orderLines}}'
  return {
    steps: [],
    transitions: [
      {
        transitionId: 'confirmation_to_end',
        activities: [
          { activityId: 'create_order', activityType: 'CALL_API', config: { endpoint: '/api/sales/orders', method: 'POST', body } },
        ],
      },
    ],
  }
}

test.describe('TC-WF-032: retire shadowing checkout-demo seed rows', () => {
  test('soft-deletes seeded rows of any name, never customizations, idempotently', async () => {
    const seededIds: Array<string | null> = []
    try {
      // Two historical seed variants that both shadow the code definition — the
      // early name is exactly the cohort a `workflow_name` fingerprint missed.
      const legacyNamed = await seedWorkflowDefinition({
        workflowName: 'Checkout with Payment Webhook',
        definition: checkoutSeed({ withoutLines: true }),
      })
      const earlyNamed = await seedWorkflowDefinition({
        workflowName: 'Simple Checkout Flow',
        definition: checkoutSeed({ withoutLines: true }),
      })
      // A user customization of the code definition — MUST be preserved.
      const customization = await seedWorkflowDefinition({
        codeWorkflowId: 'workflows.checkout-demo',
        definition: checkoutSeed(),
      })
      // An unrelated workflow — MUST be preserved.
      const unrelated = await seedWorkflowDefinition({
        workflowId: 'workflows.simple-approval',
        workflowName: 'Simple Approval',
        definition: checkoutSeed(),
      })
      // An already-retired seed — idempotency guard.
      const alreadyRetired = await seedWorkflowDefinition({
        softDeleted: true,
        definition: checkoutSeed({ withoutLines: true }),
      })
      seededIds.push(legacyNamed.id, earlyNamed.id, customization.id, unrelated.id, alreadyRetired.id)

      await runRetireSeededCheckoutDemo()

      // Both seeded checkout-demo rows are retired regardless of their name.
      expect(await isWorkflowDefinitionSoftDeleted(legacyNamed.id), 'legacy-named seed retired').toBe(true)
      expect(await isWorkflowDefinitionSoftDeleted(earlyNamed.id), 'early-named seed retired').toBe(true)

      // Guards not crossed: customization and unrelated workflow untouched.
      expect(await isWorkflowDefinitionSoftDeleted(customization.id), 'code customization preserved').toBe(false)
      expect(await isWorkflowDefinitionSoftDeleted(unrelated.id), 'unrelated workflow preserved').toBe(false)

      // Idempotency: re-running changes nothing.
      await runRetireSeededCheckoutDemo()
      expect(await isWorkflowDefinitionSoftDeleted(legacyNamed.id), 'still retired after replay').toBe(true)
      expect(await isWorkflowDefinitionSoftDeleted(customization.id), 'still preserved after replay').toBe(false)
      expect(await isWorkflowDefinitionSoftDeleted(alreadyRetired.id), 'pre-retired row still retired').toBe(true)
    } finally {
      await deleteWorkflowDefinitions(seededIds).catch(() => undefined)
    }
  })
})
