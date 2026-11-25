import { Migration } from '@mikro-orm/migrations'

export class Migration20261125183000_customers extends Migration {
  override up(): void {
    this.addSql('alter table "customer_interactions" add "body_format" text null;')
  }

  override down(): void {
    this.addSql('alter table "customer_interactions" drop column "body_format";')
  }
}
