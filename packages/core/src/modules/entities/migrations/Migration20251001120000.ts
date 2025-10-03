import { Migration } from '@mikro-orm/migrations';

export class Migration20251001120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "custom_entities" (
      "id" uuid not null default gen_random_uuid(),
      "entity_id" text not null,
      "label" text not null,
      "description" text null,
      "label_field" text null,
      "organization_id" uuid null,
      "tenant_id" uuid null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "custom_entities_pkey" primary key ("id")
    );`)
    this.addSql(`create index "custom_entities_entity_id_idx" on "custom_entities" ("entity_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "custom_entities" cascade;`)
  }
}
