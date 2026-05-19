import { Migration } from '@mikro-orm/migrations';

export class Migration20260512090000_ai_tenant_model_allowlist extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ai_tenant_model_allowlists" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "allowed_providers" jsonb null, "allowed_models_by_provider" jsonb not null default '{}', "updated_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "ai_tenant_model_allowlists_pkey" primary key ("id"));`);
    this.addSql(`create unique index "ai_tenant_model_allowlists_tenant_org_uq" on "ai_tenant_model_allowlists" ("tenant_id", "organization_id") where "deleted_at" is null and "organization_id" is not null;`);
    this.addSql(`create unique index "ai_tenant_model_allowlists_tenant_null_org_uq" on "ai_tenant_model_allowlists" ("tenant_id") where "deleted_at" is null and "organization_id" is null;`);
    this.addSql(`create index "ai_tenant_model_allowlists_tenant_idx" on "ai_tenant_model_allowlists" ("tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_tenant_model_allowlists" cascade;`);
  }

}
