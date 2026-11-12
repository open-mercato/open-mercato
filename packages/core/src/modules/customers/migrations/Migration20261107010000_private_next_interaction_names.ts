import { Migration } from '@mikro-orm/migrations'
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex'

export const queryIndexReindexEntityTypes = declareQueryIndexReindex([
  'customers:customer_entity',
  'customers:customer_person_profile',
  'customers:customer_company_profile',
])

export class Migration20261107010000_private_next_interaction_names extends Migration {
  override up(): void {
    this.addSql(`update customer_entities as entity
      set next_interaction_name = null
      where entity.next_interaction_ref_id is not null
        and entity.next_interaction_name is not null
        and not exists (
          select 1 from customer_interactions as interaction
          where interaction.id::text = entity.next_interaction_ref_id
            and interaction.entity_id = entity.id
            and interaction.tenant_id = entity.tenant_id
            and interaction.organization_id = entity.organization_id
            and (interaction.interaction_type <> 'email'
              or interaction.visibility is null
              or interaction.visibility <> 'private')
        );`)
  }

  override down(): void {}
}
