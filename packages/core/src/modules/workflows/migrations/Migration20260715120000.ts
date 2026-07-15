import { Migration } from '@mikro-orm/migrations'

const LEGACY_WORKFLOW_ID = 'workflows.checkout-demo'
const LEGACY_WORKFLOW_NAME = 'Checkout with Payment Webhook'
const LEGACY_ACTIVITY_ID = 'reserve_inventory'
const LEGACY_ACTIVITY_URL = '{{env.INVENTORY_SERVICE_URL}}/api/inventory/reserve'
const TRANSITIONS_REPLACED_BY_CODE_DEFINITION = [
  'cart_to_customer_info',
  'customer_info_to_payment',
  'confirmation_to_order',
] as const

/**
 * SQL fragment (for the UPDATE `where` clause) that matches ONLY the exact
 * legacy checkout seed: workflow id, name, version, and the presence of the
 * obsolete `reserve_inventory` `CALL_WEBHOOK` activity with its exact env-based
 * URL. The match is intentionally strict so the repair never touches a row that
 * is not the known-broken seed. A tenant whose persisted row diverges from this
 * fingerprint (renamed, re-versioned, or a different webhook URL) is left
 * untouched — the trade-off is safety over coverage for an unknown variant.
 */
export function legacyCheckoutPredicate(): string {
  return `
    "wf"."workflow_id" = '${LEGACY_WORKFLOW_ID}'
    and "wf"."workflow_name" = '${LEGACY_WORKFLOW_NAME}'
    and "wf"."version" = 1
    and exists (
      select 1
      from jsonb_array_elements(coalesce("wf"."definition"->'transitions', '[]'::jsonb)) as "transition"("value")
      cross join lateral jsonb_array_elements(coalesce("transition"."value"->'activities', '[]'::jsonb)) as "activity"("value")
      where "activity"."value"->>'activityId' = '${LEGACY_ACTIVITY_ID}'
        and "activity"."value"->>'activityType' = 'CALL_WEBHOOK'
        and "activity"."value"#>>'{config,url}' = '${LEGACY_ACTIVITY_URL}'
    )
  `.trim()
}

/**
 * The exact UPDATE the migration runs. Exported so the DB-level regression test
 * (`__integration__/TC-WF-031`) executes the identical SQL against Postgres,
 * making the jsonb transformation itself — not just its rendered string —
 * the thing under test.
 *
 * It rebuilds the `transitions` array in original order, dropping the
 * `activities` key from exactly the three transitions the maintained code
 * definition made side-effect-free. All other keys (e.g. `preConditions`) and
 * all other transitions — including `confirmation_to_end`, whose remaining
 * activities are internal (`CALL_API`/`SEND_EMAIL`/`EMIT_EVENT`) and never trip
 * the outbound URL guard — are preserved verbatim.
 */
export function buildLegacyCheckoutRepairSql(): string {
  const strippedTransitionList = TRANSITIONS_REPLACED_BY_CODE_DEFINITION
    .map((id) => `'${id}'`)
    .join(', ')
  return `
    update "workflow_definitions" as "wf"
    set "definition" = jsonb_set(
          "wf"."definition",
          '{transitions}',
          coalesce(
            (
              select jsonb_agg(
                case
                  when "transition"."value"->>'transitionId' in (${strippedTransitionList})
                    then "transition"."value" - 'activities'
                  else "transition"."value"
                end
                order by "transition"."ordinality"
              )
              from jsonb_array_elements(
                coalesce("wf"."definition"->'transitions', '[]'::jsonb)
              ) with ordinality as "transition"("value", "ordinality")
            ),
            '[]'::jsonb
          )
        ),
        "updated_at" = current_timestamp
    where "wf"."code_workflow_id" is null
      and "wf"."deleted_at" is null
      and ${legacyCheckoutPredicate()};
  `.trim()
}

/**
 * Repairs the former seeded checkout demo after it was renamed to the same ID
 * as the code-defined workflow. The DB-first lookup shadows the current code
 * definition, including its obsolete external inventory webhook.
 *
 * The persisted row must remain active because existing workflow runtime
 * handlers resolve transitions by definition_id. The migration removes the
 * activity arrays from the three transitions that the maintained code
 * definition intentionally made side-effect-free, preserving the row and all
 * historical instance references while keeping the demo self-contained.
 *
 * `confirmation_to_end` is deliberately NOT rebuilt: unlike the three stripped
 * transitions it still holds activities in the maintained code definition, and
 * its legacy-only extra (`emit_order_completed`, an internal `EMIT_EVENT`) is
 * harmless — it emits no external request, so leaving it costs nothing and
 * avoids fragile per-activity surgery that could re-introduce a failure.
 */
export class Migration20260715120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(buildLegacyCheckoutRepairSql())
  }

  override async down(): Promise<void> {
    // Forward-only data repair. The removed demo-only activity payloads cannot
    // be reconstructed safely, and restoring obsolete external webhooks would
    // re-open issue #4179.
  }
}
