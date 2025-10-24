import { Migration } from '@mikro-orm/migrations'

export class Migration20251201093000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table "perspectives" (
        "id" uuid not null default gen_random_uuid(),
        "user_id" uuid not null,
        "tenant_id" uuid null,
        "organization_id" uuid null,
        "table_id" text not null,
        "name" text not null,
        "settings_json" jsonb not null,
        "is_default" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "perspectives_pkey" primary key ("id")
      );
    `)
    this.addSql(`
      create index "perspectives_user_scope_idx"
      on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id");
    `)
    this.addSql(`
      alter table "perspectives"
      add constraint "perspectives_user_scope_name_unique"
      unique ("user_id", "tenant_id", "organization_id", "table_id", "name");
    `)

    this.addSql(`
      create table "role_perspectives" (
        "id" uuid not null default gen_random_uuid(),
        "role_id" uuid not null,
        "tenant_id" uuid null,
        "organization_id" uuid null,
        "table_id" text not null,
        "name" text not null,
        "settings_json" jsonb not null,
        "is_default" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "role_perspectives_pkey" primary key ("id")
      );
    `)
    this.addSql(`
      create index "role_perspectives_role_scope_idx"
      on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id");
    `)
    this.addSql(`
      alter table "role_perspectives"
      add constraint "role_perspectives_role_scope_name_unique"
      unique ("role_id", "tenant_id", "organization_id", "table_id", "name");
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "role_perspectives" cascade;')
    this.addSql('drop table if exists "perspectives" cascade;')
  }
}
