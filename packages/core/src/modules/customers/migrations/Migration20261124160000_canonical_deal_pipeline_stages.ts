import { Migration } from '@mikro-orm/migrations'
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex'

export const queryIndexReindexEntityTypes = declareQueryIndexReindex(['customers:customer_deal'])

export class Migration20261124160000_canonical_deal_pipeline_stages extends Migration {
  override up(): void {
    this.addSql(`update customer_deals as deal
      set pipeline_stage = entry.value
      from (values
        ('marketing qualified lead', 'marketing_qualified_lead'),
        ('sales qualified lead', 'sales_qualified_lead')
      ) as aliases(label, value)
      join customer_dictionary_entries as entry
        on entry.kind = 'pipeline_stage' and entry.normalized_value = aliases.value
      where deal.tenant_id = entry.tenant_id
        and deal.organization_id = entry.organization_id
        and lower(btrim(deal.pipeline_stage)) in (aliases.label, aliases.value)
        and deal.pipeline_stage is distinct from entry.value
        and (deal.pipeline_stage_id is null or exists (
          select 1 from customer_pipeline_stages as stage
          where stage.id = deal.pipeline_stage_id
            and stage.tenant_id = deal.tenant_id
            and stage.organization_id = deal.organization_id
            and lower(btrim(stage.name)) in (aliases.label, aliases.value)
        ));`)
  }

  override down(): void {}
}
