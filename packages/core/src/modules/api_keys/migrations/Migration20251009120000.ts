import { Migration } from '@mikro-orm/migrations';

export class Migration20251009120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "api_keys" ("id" uuid not null default gen_random_uuid(), "name" text not null, "description" text null, "tenant_id" uuid null, "organization_id" uuid null, "key_hash" text not null, "key_prefix" text not null, "roles_json" json null, "created_by" uuid null, "last_used_at" timestamptz null, "expires_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "api_keys_pkey" primary key ("id"));`);
    this.addSql(`create unique index "api_keys_key_prefix_unique" on "api_keys" ("key_prefix");`);
    this.addSql(`create index "api_keys_lookup_idx" on "api_keys" ("tenant_id", "organization_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "api_keys" cascade;`);
  }

}
