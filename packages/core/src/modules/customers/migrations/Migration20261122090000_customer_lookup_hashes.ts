import { Migration } from '@mikro-orm/migrations'

export class Migration20261122090000_customer_lookup_hashes extends Migration {
  override up(): void {
    this.addSql('alter table "customer_entities" add column "primary_email_hash" text null;')
    this.addSql('create index "customer_entities_primary_email_hash_idx" on "customer_entities" ("tenant_id", "organization_id", "primary_email_hash");')
    this.addSql('alter table "customer_companies" add column "domain_hash" text null;')
    this.addSql('create index "customer_companies_domain_hash_idx" on "customer_companies" ("tenant_id", "organization_id", "domain_hash");')
  }

  override down(): void {
    this.addSql('drop index "customer_companies_domain_hash_idx";')
    this.addSql('alter table "customer_companies" drop column "domain_hash";')
    this.addSql('drop index "customer_entities_primary_email_hash_idx";')
    this.addSql('alter table "customer_entities" drop column "primary_email_hash";')
  }
}
