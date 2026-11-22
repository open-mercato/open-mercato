import { Migration } from '@mikro-orm/migrations'

export class Migration20261122040100_customers extends Migration {
  override isTransactional(): boolean {
    return false
  }

  override up(): void {
    this.addSql('drop index concurrently if exists "customer_entities_phone_digits_hash_org_idx";')
    this.addSql('create index concurrently "customer_entities_phone_digits_hash_org_idx" on "customer_entities" ("primary_phone_digits_hash", "organization_id");')
  }

  override down(): void {
    this.addSql('drop index concurrently if exists "customer_entities_phone_digits_hash_org_idx";')
  }
}
