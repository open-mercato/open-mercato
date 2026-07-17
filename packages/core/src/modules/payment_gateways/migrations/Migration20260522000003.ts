import { Migration } from '@mikro-orm/migrations'

export class Migration20260522000003 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "gateway_subscription_mappings" add column "subject_entity_type" text null;`)
    this.addSql(`alter table "gateway_subscription_mappings" add column "subject_entity_id" uuid null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "gateway_subscription_mappings" drop column if exists "subject_entity_type";`)
    this.addSql(`alter table "gateway_subscription_mappings" drop column if exists "subject_entity_id";`)
  }
}
