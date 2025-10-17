import { Migration } from '@mikro-orm/migrations'

export class Migration20251018120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql('alter table "customer_dictionary_entries" add column "color" text null;')
    this.addSql('alter table "customer_dictionary_entries" add column "icon" text null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "customer_dictionary_entries" drop column "color";')
    this.addSql('alter table "customer_dictionary_entries" drop column "icon";')
  }

}
