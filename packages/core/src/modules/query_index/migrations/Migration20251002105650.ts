import { Migration } from '@mikro-orm/migrations';

export class Migration20251002105650 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "user_roles" drop constraint "user_roles_role_id_foreign";`);

    this.addSql(`alter table "organizations" drop constraint "organizations_tenant_id_foreign";`);

    this.addSql(`alter table "password_resets" drop constraint "password_resets_user_id_foreign";`);

    this.addSql(`alter table "sessions" drop constraint "sessions_user_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_user_id_foreign";`);

    this.addSql(`drop table if exists "custom_entities" cascade;`);

    this.addSql(`drop table if exists "custom_field_defs" cascade;`);

    this.addSql(`drop table if exists "custom_field_values" cascade;`);

    this.addSql(`drop table if exists "example_items" cascade;`);

    this.addSql(`drop table if exists "mikro_orm_migrations_auth" cascade;`);

    this.addSql(`drop table if exists "mikro_orm_migrations_custom_fields" cascade;`);

    this.addSql(`drop table if exists "mikro_orm_migrations_directory" cascade;`);

    this.addSql(`drop table if exists "mikro_orm_migrations_example" cascade;`);

    this.addSql(`drop table if exists "organizations" cascade;`);

    this.addSql(`drop table if exists "password_resets" cascade;`);

    this.addSql(`drop table if exists "roles" cascade;`);

    this.addSql(`drop table if exists "sessions" cascade;`);

    this.addSql(`drop table if exists "tenants" cascade;`);

    this.addSql(`drop table if exists "todos" cascade;`);

    this.addSql(`drop table if exists "user_roles" cascade;`);

    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop index "entity_indexes_doc_gin";`);
    this.addSql(`drop index "entity_indexes_unique_all";`);
    this.addSql(`alter table "entity_indexes" drop column "organization_id_coalesced";`);

    this.addSql(`alter table "entity_indexes" alter column "created_at" drop default;`);
    this.addSql(`alter table "entity_indexes" alter column "created_at" type timestamptz using ("created_at"::timestamptz);`);
    this.addSql(`alter table "entity_indexes" alter column "updated_at" drop default;`);
    this.addSql(`alter table "entity_indexes" alter column "updated_at" type timestamptz using ("updated_at"::timestamptz);`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "custom_entities" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "label" text not null, "description" text null, "organization_id" uuid null, "tenant_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_editor" text null, "label_field" text null, constraint "custom_entities_pkey" primary key ("id"));`);
    this.addSql(`create index "custom_entities_entity_id_idx" on "custom_entities" ("entity_id");`);

    this.addSql(`create table "custom_field_defs" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "key" text not null, "kind" text not null, "config_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_field_defs_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_defs_entity_key_idx" on "custom_field_defs" ("key");`);

    this.addSql(`create table "custom_field_values" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field_key" text not null, "value_text" text null, "value_multiline" text null, "value_int" int4 null, "value_float" float4 null, "value_bool" bool null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_field_values_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_values_entity_record_field_idx" on "custom_field_values" ("field_key");`);

    this.addSql(`create table "example_items" ("id" uuid not null default gen_random_uuid(), "title" text not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "example_items_pkey" primary key ("id"));`);

    this.addSql(`create table "mikro_orm_migrations_auth" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_custom_fields" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_directory" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_example" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "organizations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "name" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "organizations_pkey" primary key ("id"));`);

    this.addSql(`create table "password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "password_resets_pkey" primary key ("id"));`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_unique" unique ("token");`);

    this.addSql(`create table "roles" ("id" uuid not null default gen_random_uuid(), "name" text not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "roles_pkey" primary key ("id"));`);
    this.addSql(`alter table "roles" add constraint "roles_name_unique" unique ("name");`);

    this.addSql(`create table "sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, "last_used_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "sessions_pkey" primary key ("id"));`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_unique" unique ("token");`);

    this.addSql(`create table "tenants" ("id" uuid not null default gen_random_uuid(), "name" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "tenants_pkey" primary key ("id"));`);

    this.addSql(`create table "todos" ("id" uuid not null default gen_random_uuid(), "title" text not null, "tenant_id" uuid null, "organization_id" uuid null, "is_done" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "todos_pkey" primary key ("id"));`);

    this.addSql(`create table "user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "user_roles_pkey" primary key ("id"));`);

    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "email" text not null, "name" text null, "password_hash" text null, "is_confirmed" bool not null default true, "last_login_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`alter table "entity_indexes" add column "organization_id_coalesced" uuid generated always as COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid) stored null;`);
    this.addSql(`alter table "entity_indexes" alter column "created_at" type timestamptz(6) using ("created_at"::timestamptz(6));`);
    this.addSql(`alter table "entity_indexes" alter column "created_at" set default now();`);
    this.addSql(`alter table "entity_indexes" alter column "updated_at" type timestamptz(6) using ("updated_at"::timestamptz(6));`);
    this.addSql(`alter table "entity_indexes" alter column "updated_at" set default now();`);
    this.addSql(`create index "entity_indexes_doc_gin" on "entity_indexes" ("doc");`);
    this.addSql(`alter table "entity_indexes" add constraint "entity_indexes_unique_all" unique ("entity_type", "entity_id", "organization_id_coalesced");`);
  }

}
