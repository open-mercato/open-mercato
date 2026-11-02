import { Migration } from '@mikro-orm/migrations';

export class Migration20260508135459_forms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "forms_form" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "status" text not null default 'draft', "current_published_version_id" uuid null, "default_locale" text not null, "supported_locales" text[] not null, "created_by" uuid not null, "archived_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_form_org_tenant_deleted_idx" on "forms_form" ("organization_id", "tenant_id", "deleted_at");`);
    this.addSql(`create index "forms_form_org_status_idx" on "forms_form" ("organization_id", "status");`);
    this.addSql(`alter table "forms_form" add constraint "forms_form_org_key_unique" unique ("organization_id", "key");`);

    this.addSql(`create table "forms_form_version" ("id" uuid not null default gen_random_uuid(), "form_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "version_number" int not null, "status" text not null default 'draft', "schema" jsonb not null, "ui_schema" jsonb not null, "roles" jsonb not null, "schema_hash" text not null, "registry_version" text not null, "published_at" timestamptz null, "published_by" uuid null, "changelog" text null, "archived_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "forms_form_version_org_tenant_idx" on "forms_form_version" ("organization_id", "tenant_id");`);
    this.addSql(`create index "forms_form_version_form_id_status_idx" on "forms_form_version" ("form_id", "status");`);
    this.addSql(`alter table "forms_form_version" add constraint "forms_form_version_form_id_version_number_unique" unique ("form_id", "version_number");`);
  }

}
