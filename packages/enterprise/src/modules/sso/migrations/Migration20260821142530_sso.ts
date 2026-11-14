import { Migration } from '@mikro-orm/migrations';

export class Migration20260821142530_sso extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "scim_groups" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "sso_config_id" uuid not null, "external_id" text null, "display_name" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "scim_groups_config_created_idx" on "scim_groups" ("sso_config_id", "created_at");`);
    this.addSql(`alter table "scim_groups" add constraint "scim_groups_config_external_unique" unique ("sso_config_id", "external_id");`);

    this.addSql(`create table "scim_group_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "sso_config_id" uuid not null, "group_id" uuid not null, "identity_id" uuid not null, "user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "scim_group_members_identity_idx" on "scim_group_members" ("identity_id");`);
    this.addSql(`create index "scim_group_members_group_idx" on "scim_group_members" ("group_id");`);
    this.addSql(`alter table "scim_group_members" add constraint "scim_group_members_group_identity_unique" unique ("group_id", "identity_id");`);

  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "scim_group_members" cascade;`);
    this.addSql(`drop table if exists "scim_groups" cascade;`);
  }

}
