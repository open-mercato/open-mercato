import { Migration } from '@mikro-orm/migrations'

export class Migration20261122040000_customers extends Migration {
  override up(): void {
    this.addSql('alter table "customer_entities" add column "primary_phone_digits_hash" text null;')
    this.addSql('create index "customer_entities_phone_digits_hash_org_idx" on "customer_entities" ("primary_phone_digits_hash", "organization_id");')
  }

  override down(): void {
    this.addSql('drop index "customer_entities_phone_digits_hash_org_idx";')
    this.addSql('alter table "customer_entities" drop column "primary_phone_digits_hash";')
  }
}
