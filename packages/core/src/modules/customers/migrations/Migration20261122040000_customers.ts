import { Migration } from '@mikro-orm/migrations'

export class Migration20261122040000_customers extends Migration {
  override up(): void {
    this.addSql('alter table "customer_entities" add column "primary_phone_digits_hash" text null;')
  }

  override down(): void {
    this.addSql('alter table "customer_entities" drop column "primary_phone_digits_hash";')
  }
}
