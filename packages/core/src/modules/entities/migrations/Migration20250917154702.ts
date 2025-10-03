import { Migration } from '@mikro-orm/migrations';

export class Migration20250917154702 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "custom_field_defs" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "key" text not null, "kind" text not null, "config_json" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "custom_field_defs_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_defs_entity_key_idx" on "custom_field_defs" ("key");`);

    this.addSql(`create table "custom_field_values" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field_key" text not null, "value_text" text null, "value_multiline" text null, "value_int" int null, "value_float" real null, "value_bool" boolean null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "custom_field_values_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_values_entity_record_field_idx" on "custom_field_values" ("field_key");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "custom_field_defs" cascade;`);

    this.addSql(`drop table if exists "custom_field_values" cascade;`);
  }

}
