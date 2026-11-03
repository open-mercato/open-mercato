import { Migration } from '@mikro-orm/migrations';

export class Migration20260727074335_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "workflow_definition_drafts" ("id" uuid not null default gen_random_uuid(), "definition_id" uuid null, "user_id" uuid not null, "definition" jsonb not null, "metadata" jsonb null, "base_updated_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "workflow_definition_drafts_tenant_org_idx" on "workflow_definition_drafts" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "workflow_definition_drafts" add constraint "workflow_definition_drafts_definition_id_user_id__e3189_unique" unique ("definition_id", "user_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "workflow_definition_drafts" cascade;`);
  }

}
