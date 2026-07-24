import { Migration } from '@mikro-orm/migrations';

/**
 * Builds the one-off repair for `customer_users.customer_entity_id` (#4473).
 *
 * `customerEntityId` is the CRM *company* FK and the portal company scope key —
 * the portal Users page, portal invitations, and the company detail "Portal
 * users" group all filter on it. Earlier invite flows (#4362) could store a
 * person entity id, or an entity from another organization, in that column.
 * The `autoLinkCrm` subscriber normalizes it (#4457), but it only runs on
 * `customer_accounts.user.created`, which is never re-emitted for a row that
 * already exists — so users created before that fix keep the bad FK forever.
 * They stay scoped to the wrong company and every admin edit that resubmits the
 * pre-filled value fails with "Company not found".
 *
 * The repair mirrors the subscriber's normalization exactly: touch only rows
 * whose FK does NOT resolve to an in-org, non-deleted `company` entity, and for
 * those either recover the real company from the person's profile (when the FK
 * points at an in-org person whose company is itself in-org) or clear it.
 *
 * `updated_at` is bumped on every repaired row on purpose: it is the optimistic
 * lock version. Without the bump a client holding the pre-repair version could
 * resubmit the poisoned value and silently undo the fix instead of getting a
 * 409 conflict.
 *
 * The whole statement is wrapped in a `to_regclass` guard because the `customers`
 * tables it reads belong to a different module. `dbMigrate` walks enabled modules
 * in alphabetical order, so `customer_accounts` migrations run BEFORE `customers`
 * ones — on a fresh database these tables do not exist yet. A database in that
 * state has no poisoned rows to repair either, so skipping is the correct no-op.
 * `catalog/Migration20251116191744` already ships the same guarded `do $$` idiom.
 *
 * This SQL is hand-written rather than produced by `yarn db:generate`, which the
 * review checklist otherwise requires. The generator only diffs entities against
 * the schema snapshot, so it cannot emit a data repair, and there is no schema
 * change here to diff: no column, index, or constraint is touched, which is why
 * `.snapshot-open-mercato.json` is deliberately left untouched by this migration.
 *
 * @public Exported for testing
 */
export function buildRepairPoisonedCustomerEntityLinksSql(): string {
  return `do $$
begin
  if to_regclass('customer_entities') is null or to_regclass('customer_people') is null then
    return;
  end if;

  update "customer_users" cu
     set "customer_entity_id" = (
           select company."id"
             from "customer_entities" person
             join "customer_people" profile
               on profile."entity_id" = person."id"
              and profile."tenant_id" = person."tenant_id"
              and profile."organization_id" = person."organization_id"
             join "customer_entities" company
               on company."id" = profile."company_entity_id"
              and company."tenant_id" = person."tenant_id"
              and company."organization_id" = person."organization_id"
              and company."kind" = 'company'
              and company."deleted_at" is null
            where person."id" = cu."customer_entity_id"
              and person."tenant_id" = cu."tenant_id"
              and person."organization_id" = cu."organization_id"
              and person."kind" = 'person'
              and person."deleted_at" is null
            order by profile."created_at", profile."id"
            limit 1
         ),
         "updated_at" = now()
   where cu."customer_entity_id" is not null
     and not exists (
           select 1
             from "customer_entities" company
            where company."id" = cu."customer_entity_id"
              and company."tenant_id" = cu."tenant_id"
              and company."organization_id" = cu."organization_id"
              and company."kind" = 'company'
              and company."deleted_at" is null
         );
end
$$;`;
}

export class Migration20260724120000_customer_accounts extends Migration {

  override up(): void | Promise<void> {
    this.addSql(buildRepairPoisonedCustomerEntityLinksSql());
  }

  override down(): void | Promise<void> {
    // Forward-only: the poisoned values are not recorded anywhere, so there is
    // nothing to restore. Re-poisoning the column would reintroduce the bug.
  }

}
