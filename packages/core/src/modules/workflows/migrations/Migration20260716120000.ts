import { Migration } from '@mikro-orm/migrations'

const LEGACY_WORKFLOW_ID = 'workflows.checkout-demo'
const LEGACY_WORKFLOW_NAME = 'Checkout with Payment Webhook'
const ORDER_TRANSITION_ID = 'confirmation_to_end'
const CREATE_ORDER_ACTIVITY_ID = 'create_order'
const ORDER_LINES_INTERPOLATION = '{{context.cart.orderLines}}'

/**
 * SQL fragment (for the UPDATE `where` clause) that matches ONLY a legacy
 * persisted checkout seed whose `create_order` CALL_API activity is still
 * missing the `lines` field in its request body. The `#> '{config,body,lines}'
 * is null` clause makes the migration idempotent: once the field is present the
 * row no longer matches, so re-running is a no-op, and a tenant who already
 * customized `lines` is never clobbered.
 */
export function legacyCheckoutOrderLinesPredicate(): string {
  return `
    "wf"."workflow_id" = '${LEGACY_WORKFLOW_ID}'
    and "wf"."workflow_name" = '${LEGACY_WORKFLOW_NAME}'
    and "wf"."version" = 1
    and exists (
      select 1
      from jsonb_array_elements(coalesce("wf"."definition"->'transitions', '[]'::jsonb)) as "transition"("value")
      cross join lateral jsonb_array_elements(coalesce("transition"."value"->'activities', '[]'::jsonb)) as "activity"("value")
      where "transition"."value"->>'transitionId' = '${ORDER_TRANSITION_ID}'
        and "activity"."value"->>'activityId' = '${CREATE_ORDER_ACTIVITY_ID}'
        and "activity"."value"->>'activityType' = 'CALL_API'
        and "activity"."value" #> '{config,body}' is not null
        and "activity"."value" #> '{config,body,lines}' is null
    )
  `.trim()
}

/**
 * The exact UPDATE the migration runs. Exported so the DB-level regression test
 * (`__integration__/TC-WF-032`) executes the identical SQL against Postgres,
 * making the jsonb transformation itself — not just its rendered string — the
 * thing under test.
 *
 * It rebuilds the `transitions` array in original order; only the
 * `confirmation_to_end` transition is rewritten, and within it only the
 * `create_order` CALL_API activity, whose `config.body` gains
 * `lines: '{{context.cart.orderLines}}'`. Every other transition, activity, and
 * body field is preserved verbatim.
 */
export function buildCheckoutOrderLinesRepairSql(): string {
  return `
    update "workflow_definitions" as "wf"
    set "definition" = jsonb_set(
          "wf"."definition",
          '{transitions}',
          coalesce(
            (
              select jsonb_agg(
                case
                  when "transition"."value"->>'transitionId' = '${ORDER_TRANSITION_ID}'
                    then jsonb_set(
                      "transition"."value",
                      '{activities}',
                      coalesce(
                        (
                          select jsonb_agg(
                            case
                              when "activity"."value"->>'activityId' = '${CREATE_ORDER_ACTIVITY_ID}'
                                and "activity"."value"->>'activityType' = 'CALL_API'
                                and "activity"."value" #> '{config,body}' is not null
                                and "activity"."value" #> '{config,body,lines}' is null
                                then jsonb_set(
                                  "activity"."value",
                                  '{config,body,lines}',
                                  '"${ORDER_LINES_INTERPOLATION}"'::jsonb,
                                  true
                                )
                              else "activity"."value"
                            end
                            order by "activity"."ordinality"
                          )
                          from jsonb_array_elements(
                            coalesce("transition"."value"->'activities', '[]'::jsonb)
                          ) with ordinality as "activity"("value", "ordinality")
                        ),
                        '[]'::jsonb
                      )
                    )
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
      and ${legacyCheckoutOrderLinesPredicate()};
  `.trim()
}

/**
 * Repairs the persisted legacy checkout demo so its `create_order` activity
 * forwards the cart's line items to `POST /api/sales/orders` (issue #4211).
 *
 * The former seed built the order body with only header/total fields and never
 * sent `lines`. Because the sales create command recomputes every total from
 * the persisted lines, an order created by the legacy definition came out with
 * zero line items and $0.00 totals. The maintained code definition already
 * carries `lines: '{{context.cart.orderLines}}'`; this migration back-fills the
 * same field into persisted rows that runtime still serves via the DB-first
 * lookup (`find-definition.ts`), so historical/in-flight instances that
 * reference the row by `definition_id` are fixed without touching their id.
 *
 * Fresh installs never had this row — they execute the virtual code definition
 * directly via `findDefinitionForInstance` — so they are unaffected. The update
 * is idempotent and never overwrites a `lines` value a tenant already set.
 */
export class Migration20260716120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(buildCheckoutOrderLinesRepairSql())
  }

  override async down(): Promise<void> {
    // Forward-only data repair. Removing the back-filled `lines` field would
    // re-introduce the zero-line / $0.00 order bug (#4211) and cannot know
    // whether a later edit intentionally set it, so the rollback is a no-op.
  }
}
