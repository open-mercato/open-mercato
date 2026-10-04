import { Migration } from '@mikro-orm/migrations';

/**
 * Rename the misspelled lost-deal vocabulary `loose` to `lost`.
 *
 * `loose` was the canonical spelling the UI closure flows, the kanban board and the seeded
 * dictionaries persisted up to 0.7.0. `lost` is what every other surface already used
 * (`closure_outcome`, the AI stage tool, every operator-facing label), so the two spellings
 * had to be reconciled anywhere a reader joined them.
 *
 * Forward-only and conservative. Nothing is deleted, and a row is left alone whenever
 * renaming it would collide with an entry the tenant already has:
 *
 *   - `customer_deals.status` / `pipeline_stage`: `loose` -> `lost`.
 *   - `customer_dictionary_entries` (`deal_status`, `pipeline_stage`): the `loose` entry is
 *     renamed only when the same scope has no `lost` entry, since
 *     `customer_dictionary_entries_unique` covers (org, tenant, kind, normalized_value).
 *     Its label is corrected only when it is still the seeded `Loose`, so a tenant that
 *     renamed the option keeps its own wording.
 *   - `customer_pipeline_stages.name`: the seeded `Loose` label becomes `Lost`.
 *
 * Readers keep accepting `loose` (see `lib/dealStatus.ts`), so an instance that skips this
 * migration, or a row this migration deliberately leaves behind, still classifies correctly.
 */
export class Migration20260824180000_deal_status_lost extends Migration {
  override async up(): Promise<void> {
    this.addSql(`update "customer_deals" set "status" = 'lost' where lower("status") = 'loose';`);
    this.addSql(`update "customer_deals" set "pipeline_stage" = 'lost' where lower("pipeline_stage") = 'loose';`);

    this.addSql(`
      update "customer_dictionary_entries" as e
      set "value" = 'lost',
          "normalized_value" = 'lost',
          "label" = case when e."label" = 'Loose' then 'Lost' else e."label" end,
          "updated_at" = now()
      where e."kind" in ('deal_status', 'pipeline_stage')
        and e."normalized_value" = 'loose'
        and not exists (
          select 1 from "customer_dictionary_entries" as other
          where other."organization_id" = e."organization_id"
            and other."tenant_id" = e."tenant_id"
            and other."kind" = e."kind"
            and other."normalized_value" = 'lost'
        );
    `);

    this.addSql(`update "customer_pipeline_stages" set "name" = 'Lost', "updated_at" = now() where "name" = 'Loose';`);
  }

  override async down(): Promise<void> {
    // Reverting is lossy: an instance may have carried `lost` rows before this migration ran,
    // and those are indistinguishable afterwards from the ones it renamed. Readers accept
    // both spellings, so leaving the data on the canonical `lost` is the safe no-op.
  }
}
