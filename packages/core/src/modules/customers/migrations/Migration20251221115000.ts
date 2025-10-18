import { Migration } from '@mikro-orm/migrations'

export class Migration20251221115000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "customer_entities" add column "next_interaction_icon" text null;`)
    this.addSql(`alter table "customer_entities" add column "next_interaction_color" text null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "customer_entities" drop column if exists "next_interaction_color";`)
    this.addSql(`alter table "customer_entities" drop column if exists "next_interaction_icon";`)
  }
}
