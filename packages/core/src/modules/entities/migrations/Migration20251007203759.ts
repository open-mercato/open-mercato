import { Migration } from '@mikro-orm/migrations';

export class Migration20251007203759 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "custom_entities_storage" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "doc" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "custom_entities_storage_pkey" primary key ("id"));`);
    this.addSql(`create index "custom_entities_storage_unique_idx" on "custom_entities_storage" ("entity_type", "entity_id", "organization_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "custom_entities_storage" cascade;`);
  }

}
