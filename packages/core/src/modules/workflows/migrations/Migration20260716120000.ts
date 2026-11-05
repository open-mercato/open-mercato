import { Migration } from '@mikro-orm/migrations'

const CODE_WORKFLOW_ID = 'workflows.checkout-demo'

/**
 * Retires the persisted checkout-demo seed rows so runtime resolves the
 * maintained CODE definition instead (issue #4211).
 *
 * Background: `workflows.checkout-demo` is now code-defined
 * (`packages/core/src/modules/workflows/workflows.ts`), and only the code
 * definition forwards the cart's line items + shipping/tax adjustments to
 * `POST /api/sales/orders`. But existing tenants still carry a persisted
 * `workflow_definitions` row from the old seed — originally seeded under ids
 * like `checkout_simple_v1` / names like `Simple Checkout Flow` and later
 * `Checkout with Payment Webhook`, then renamed to `workflows.checkout-demo`
 * by Migration20260428102318. Its `create_order` body never sent `lines`, and
 * because `findWorkflowDefinition` resolves the DB row first, that stale row
 * SHADOWS the code definition — so orders come out with zero line items and
 * $0.00 totals. Patching the persisted body is unreliable: the seed's name and
 * body shape vary across historical versions, so a fingerprint on either misses
 * whole cohorts of tenants (the defect QA hit).
 *
 * Instead, soft-delete the seeded rows. This is body/name-agnostic, so it fixes
 * every historical seed variant:
 *   - New instances: `findWorkflowDefinition` filters `deleted_at IS NULL`, so
 *     the retired row is skipped and the code definition is used (correct body).
 *   - In-flight instances: `findDefinitionForInstance` loads the definition by
 *     `id` with no soft-delete filter (WorkflowDefinition has no global filter),
 *     so instances that reference the row keep resolving and advancing.
 *
 * Scope is limited to `code_workflow_id IS NULL` rows — user customizations of
 * the code definition set `code_workflow_id` and MUST NOT be retired. The
 * `deleted_at IS NULL` guard makes the migration idempotent.
 */
export function buildRetireSeededCheckoutDemoSql(): string {
  return `
    update "workflow_definitions" as "wf"
    set "deleted_at" = current_timestamp,
        "updated_at" = current_timestamp
    where "wf"."workflow_id" = '${CODE_WORKFLOW_ID}'
      and "wf"."code_workflow_id" is null
      and "wf"."deleted_at" is null;
  `.trim()
}

export class Migration20260716120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(buildRetireSeededCheckoutDemoSql())
  }

  override async down(): Promise<void> {
    // Forward-only. Restoring `deleted_at = null` would re-shadow the maintained
    // code definition with the stale seed body and re-introduce zero-line orders
    // (#4211). The code definition supersedes the seed, so there is nothing to
    // restore.
  }
}
