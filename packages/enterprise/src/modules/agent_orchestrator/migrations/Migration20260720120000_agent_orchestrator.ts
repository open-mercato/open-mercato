import { Migration } from '@mikro-orm/migrations';

export class Migration20260720120000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table if not exists "agent_run_artifacts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "file_name" varchar(255) not null, "mime_type" varchar(150) not null, "file_size" int not null, "sha256" varchar(64) not null, "storage_key" varchar(500) not null, "caption" text null, "source" varchar(20) not null default 'agent_output', "promoted_attachment_id" uuid null, "created_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index if not exists "agent_run_artifacts_run_sha_uq" on "agent_run_artifacts" ("run_id", "sha256", "file_name");`);
    this.addSql(`create index if not exists "agent_run_artifacts_run_idx" on "agent_run_artifacts" ("organization_id", "run_id");`);
    this.addSql(`create index if not exists "agent_run_artifacts_tenant_org_idx" on "agent_run_artifacts" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_run_artifacts";`);
  }

}
