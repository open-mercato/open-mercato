import { Migration } from '@mikro-orm/migrations'

export class Migration20261122090000_customer_lookup_hashes extends Migration {
  override up(): void {
    this.addSql('alter table "customer_entities" add column "primary_email_hash" text null;')
    this.addSql('create index "customer_entities_primary_email_hash_idx" on "customer_entities" ("tenant_id", "organization_id", "primary_email_hash");')
    this.addSql('alter table "customer_companies" add column "domain_hash" text null;')
    this.addSql('create index "customer_companies_domain_hash_idx" on "customer_companies" ("tenant_id", "organization_id", "domain_hash");')
  }

  override down(): void {
    this.addSql(`do $$
begin
  if to_regclass('encryption_maps') is not null then
    update "encryption_maps" map
    set "fields_json" = (
      select jsonb_agg(
        case when rule->>'hashField' = any(target.hash_fields) then rule - 'hashField' else rule end
        order by position
      )
      from jsonb_array_elements(map."fields_json") with ordinality as rules(rule, position)
    ), "updated_at" = now()
    from (values
      ('customers:customer_entity', array['primary_email_hash', 'primaryEmailHash']),
      ('customers:customer_company_profile', array['domain_hash', 'domainHash'])
    ) as target(entity_id, hash_fields)
    where map."entity_id" = target.entity_id and jsonb_typeof(map."fields_json") = 'array'
      and exists (
        select 1
        from jsonb_array_elements(case when jsonb_typeof(map."fields_json") = 'array' then map."fields_json" else '[]'::jsonb end) as rule
        where rule->>'hashField' = any(target.hash_fields)
      );
  end if;
  if to_regclass('upgrade_action_runs') is not null then
    delete from "upgrade_action_runs" where "action_id" = 'customers.seed-email-domain-hash-encryption-map';
  end if;
end
$$;`)
    this.addSql('drop index "customer_companies_domain_hash_idx";')
    this.addSql('alter table "customer_companies" drop column "domain_hash";')
    this.addSql('drop index "customer_entities_primary_email_hash_idx";')
    this.addSql('alter table "customer_entities" drop column "primary_email_hash";')
  }
}
