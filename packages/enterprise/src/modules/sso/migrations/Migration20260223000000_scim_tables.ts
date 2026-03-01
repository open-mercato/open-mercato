import { Migration } from '@mikro-orm/migrations';

export class Migration20260223000000_scim_tables extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "scim_tokens" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "sso_config_id" uuid not null, "name" text not null, "token_hash" text not null, "token_prefix" text not null, "is_active" boolean not null default true, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "scim_tokens_pkey" primary key ("id"));`);
    this.addSql(`create index "scim_tokens_sso_config_id_idx" on "scim_tokens" ("sso_config_id");`);
    this.addSql(`create index "scim_tokens_token_prefix_idx" on "scim_tokens" ("token_prefix");`);

    this.addSql(`create table "sso_user_deactivations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "user_id" uuid not null, "sso_config_id" uuid not null, "deactivated_at" timestamptz not null, "reactivated_at" timestamptz null, "created_at" timestamptz not null, constraint "sso_user_deactivations_pkey" primary key ("id"));`);
    this.addSql(`create index "sso_user_deactivations_user_id_idx" on "sso_user_deactivations" ("user_id");`);
    this.addSql(`alter table "sso_user_deactivations" add constraint "sso_user_deactivations_user_config_unique" unique ("user_id", "sso_config_id");`);

    this.addSql(`create table "scim_provisioning_log" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "sso_config_id" uuid not null, "operation" text not null, "resource_type" text not null, "resource_id" uuid null, "scim_external_id" text null, "response_status" int not null, "error_message" text null, "created_at" timestamptz not null, constraint "scim_provisioning_log_pkey" primary key ("id"));`);
    this.addSql(`create index "scim_provisioning_log_config_created_idx" on "scim_provisioning_log" ("sso_config_id", "created_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "scim_provisioning_log" cascade;`);
    this.addSql(`drop table if exists "sso_user_deactivations" cascade;`);
    this.addSql(`drop table if exists "scim_tokens" cascade;`);
  }

}
