import { Migration } from '@mikro-orm/migrations';

export class Migration20251025091717 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "roles" ("id" uuid not null default gen_random_uuid(), "name" text not null, "tenant_id" uuid null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "roles_pkey" primary key ("id"));`);
    this.addSql(`alter table "roles" add constraint "roles_name_unique" unique ("name");`);

    this.addSql(`create table "role_acls" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" boolean not null default false, "organizations_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "role_acls_pkey" primary key ("id"));`);

    this.addSql(`create table "role_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "role_sidebar_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_tenant_id_locale_unique" unique ("role_id", "tenant_id", "locale");`);

    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "email" text not null, "name" text null, "password_hash" text null, "is_confirmed" boolean not null default true, "last_login_at" timestamptz null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz not null, "created_at" timestamptz not null, "last_used_at" timestamptz null, "deleted_at" timestamptz null, constraint "sessions_pkey" primary key ("id"));`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_unique" unique ("token");`);

    this.addSql(`create table "password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz not null, "used_at" timestamptz null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "password_resets_pkey" primary key ("id"));`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_unique" unique ("token");`);

    this.addSql(`create table "user_acls" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" boolean not null default false, "organizations_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "user_acls_pkey" primary key ("id"));`);

    this.addSql(`create table "user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "user_roles_pkey" primary key ("id"));`);

    this.addSql(`create table "user_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "user_sidebar_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_tenant_id_organi_f3f2f_unique" unique ("user_id", "tenant_id", "organization_id", "locale");`);

    this.addSql(`alter table "role_acls" add constraint "role_acls_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade;`);

    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade;`);

    this.addSql(`alter table "sessions" add constraint "sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "password_resets" add constraint "password_resets_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "user_acls" add constraint "user_acls_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "user_roles" add constraint "user_roles_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
    this.addSql(`alter table "user_roles" add constraint "user_roles_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade;`);

    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "role_acls" drop constraint "role_acls_role_id_foreign";`);

    this.addSql(`alter table "role_sidebar_preferences" drop constraint "role_sidebar_preferences_role_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_role_id_foreign";`);

    this.addSql(`alter table "sessions" drop constraint "sessions_user_id_foreign";`);

    this.addSql(`alter table "password_resets" drop constraint "password_resets_user_id_foreign";`);

    this.addSql(`alter table "user_acls" drop constraint "user_acls_user_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_user_id_foreign";`);

    this.addSql(`alter table "user_sidebar_preferences" drop constraint "user_sidebar_preferences_user_id_foreign";`);

    this.addSql(`drop table if exists "roles" cascade;`);

    this.addSql(`drop table if exists "role_acls" cascade;`);

    this.addSql(`drop table if exists "role_sidebar_preferences" cascade;`);

    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop table if exists "sessions" cascade;`);

    this.addSql(`drop table if exists "password_resets" cascade;`);

    this.addSql(`drop table if exists "user_acls" cascade;`);

    this.addSql(`drop table if exists "user_roles" cascade;`);

    this.addSql(`drop table if exists "user_sidebar_preferences" cascade;`);
  }

}
