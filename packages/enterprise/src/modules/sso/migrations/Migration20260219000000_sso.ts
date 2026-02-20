import { Migration } from '@mikro-orm/migrations';

export class Migration20260219000000_sso extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sso_configs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "protocol" text not null, "issuer" text null, "client_id" text null, "client_secret_enc" text null, "allowed_domains" jsonb not null default '[]', "jit_enabled" boolean not null default true, "auto_link_by_email" boolean not null default true, "is_active" boolean not null default false, "sso_required" boolean not null default false, "default_role_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sso_configs_pkey" primary key ("id"));`);
    this.addSql(`alter table "sso_configs" add constraint "sso_configs_organization_id_unique" unique ("organization_id");`);

    this.addSql(`create table "sso_identities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid not null, "sso_config_id" uuid not null, "user_id" uuid not null, "idp_subject" text not null, "idp_email" text not null, "idp_name" text null, "idp_groups" jsonb not null default '[]', "provisioning_method" text not null, "first_login_at" timestamptz null, "last_login_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sso_identities_pkey" primary key ("id"));`);
    this.addSql(`alter table "sso_identities" add constraint "sso_identities_config_user_unique" unique ("sso_config_id", "user_id");`);
    this.addSql(`alter table "sso_identities" add constraint "sso_identities_config_subject_unique" unique ("sso_config_id", "idp_subject");`);
    this.addSql(`create index "sso_identities_config_id_idx" on "sso_identities" ("sso_config_id");`);
    this.addSql(`create index "sso_identities_user_id_idx" on "sso_identities" ("user_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sso_configs" cascade;`);
    this.addSql(`drop table if exists "sso_identities" cascade;`);
  }

}
