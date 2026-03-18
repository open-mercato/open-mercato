import { Migration } from '@mikro-orm/migrations';

export class Migration20260318113123 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "payment_link_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "is_default" boolean not null default false, "branding" jsonb null, "default_title" text null, "default_description" text null, "custom_fields" jsonb null, "custom_fieldset_code" text null, "customer_capture" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_link_templates_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_payment_link_templates_org_tenant" on "payment_link_templates" ("organization_id", "tenant_id");`);
  }

}
