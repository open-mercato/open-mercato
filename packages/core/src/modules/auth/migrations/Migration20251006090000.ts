import { Migration } from '@mikro-orm/migrations'

export class Migration20251006090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "role_acls" (
      "id" uuid not null default gen_random_uuid(),
      "role_id" uuid not null,
      "tenant_id" uuid not null,
      "features_json" jsonb null,
      "is_super_admin" boolean not null default false,
      "organizations_json" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz null,
      "deleted_at" timestamptz null,
      constraint "role_acls_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "role_acls_role_tenant_idx" on "role_acls" ("role_id","tenant_id");`)

    this.addSql(`create table if not exists "user_acls" (
      "id" uuid not null default gen_random_uuid(),
      "user_id" uuid not null,
      "tenant_id" uuid not null,
      "features_json" jsonb null,
      "is_super_admin" boolean not null default false,
      "organizations_json" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz null,
      "deleted_at" timestamptz null,
      constraint "user_acls_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "user_acls_user_tenant_idx" on "user_acls" ("user_id","tenant_id");`)
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "role_acls" cascade;')
    this.addSql('drop table if exists "user_acls" cascade;')
  }
}


