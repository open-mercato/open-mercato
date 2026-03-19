import { Migration } from '@mikro-orm/migrations';

export class Migration20260313222043 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "slug" text not null, "description" text null, "is_default" boolean not null default false, "is_system" boolean not null default false, "customer_assignable" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "customer_roles_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_roles" add constraint "customer_roles_tenant_slug_uniq" unique ("tenant_id", "slug");`);

    this.addSql(`create table "customer_role_acls" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_portal_admin" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "customer_role_acls_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_role_acls" add constraint "customer_role_acls_role_tenant_uniq" unique ("role_id", "tenant_id");`);

    this.addSql(`create table "customer_users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "email" text not null, "email_hash" text not null, "password_hash" text null, "display_name" text not null, "email_verified_at" timestamptz null, "failed_login_attempts" int not null default 0, "locked_until" timestamptz null, "last_login_at" timestamptz null, "person_entity_id" uuid null, "customer_entity_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "customer_users_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_users_email_hash_idx" on "customer_users" ("email_hash");`);
    this.addSql(`create index "customer_users_person_entity_idx" on "customer_users" ("person_entity_id");`);
    this.addSql(`create index "customer_users_customer_entity_idx" on "customer_users" ("customer_entity_id");`);
    this.addSql(`alter table "customer_users" add constraint "customer_users_tenant_email_hash_uniq" unique ("tenant_id", "email_hash");`);

    this.addSql(`create table "customer_user_acls" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_portal_admin" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "customer_user_acls_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_user_acls" add constraint "customer_user_acls_user_tenant_uniq" unique ("user_id", "tenant_id");`);

    this.addSql(`create table "customer_user_email_verifications" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "purpose" text not null default 'email_verification', "expires_at" timestamptz not null, "used_at" timestamptz null, "created_at" timestamptz not null, constraint "customer_user_email_verifications_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_user_email_verifications_token_idx" on "customer_user_email_verifications" ("token");`);

    this.addSql(`create table "customer_user_invitations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "email" text not null, "email_hash" text not null, "token" text not null, "customer_entity_id" uuid null, "role_ids_json" jsonb null, "invited_by_user_id" uuid null, "invited_by_customer_user_id" uuid null, "display_name" text null, "expires_at" timestamptz not null, "accepted_at" timestamptz null, "cancelled_at" timestamptz null, "created_at" timestamptz not null, constraint "customer_user_invitations_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_user_invitations_tenant_email_hash_idx" on "customer_user_invitations" ("tenant_id", "email_hash");`);
    this.addSql(`create index "customer_user_invitations_token_idx" on "customer_user_invitations" ("token");`);

    this.addSql(`create table "customer_user_password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz not null, "used_at" timestamptz null, "created_at" timestamptz not null, constraint "customer_user_password_resets_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_user_password_resets_token_idx" on "customer_user_password_resets" ("token");`);

    this.addSql(`create table "customer_user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "customer_user_roles_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_user_roles" add constraint "customer_user_roles_user_role_uniq" unique ("user_id", "role_id");`);

    this.addSql(`create table "customer_user_sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token_hash" text not null, "ip_address" text null, "user_agent" text null, "expires_at" timestamptz not null, "last_used_at" timestamptz null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "customer_user_sessions_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_user_sessions_token_hash_idx" on "customer_user_sessions" ("token_hash");`);

    this.addSql(`alter table "customer_role_acls" add constraint "customer_role_acls_role_id_foreign" foreign key ("role_id") references "customer_roles" ("id") on update cascade;`);

    this.addSql(`alter table "customer_user_acls" add constraint "customer_user_acls_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade;`);

    this.addSql(`alter table "customer_user_email_verifications" add constraint "customer_user_email_verifications_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade;`);

    this.addSql(`alter table "customer_user_password_resets" add constraint "customer_user_password_resets_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade;`);

    this.addSql(`alter table "customer_user_roles" add constraint "customer_user_roles_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade;`);
    this.addSql(`alter table "customer_user_roles" add constraint "customer_user_roles_role_id_foreign" foreign key ("role_id") references "customer_roles" ("id") on update cascade;`);

    this.addSql(`alter table "customer_user_sessions" add constraint "customer_user_sessions_user_id_foreign" foreign key ("user_id") references "customer_users" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_user_sessions" cascade;`);
    this.addSql(`drop table if exists "customer_user_roles" cascade;`);
    this.addSql(`drop table if exists "customer_user_password_resets" cascade;`);
    this.addSql(`drop table if exists "customer_user_invitations" cascade;`);
    this.addSql(`drop table if exists "customer_user_email_verifications" cascade;`);
    this.addSql(`drop table if exists "customer_user_acls" cascade;`);
    this.addSql(`drop table if exists "customer_role_acls" cascade;`);
    this.addSql(`drop table if exists "customer_users" cascade;`);
    this.addSql(`drop table if exists "customer_roles" cascade;`);
  }
}
