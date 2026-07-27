import { Migration } from '@mikro-orm/migrations';

export class Migration20260625000000_agent_orchestrator extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "agent_metric_rollups" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "agent_id" varchar(100) not null, "window_start" timestamptz not null, "window_end" timestamptz not null, "computed_at" timestamptz not null, "metrics" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "agent_metric_rollups_lookup_idx" on "agent_metric_rollups" ("organization_id", "agent_id", "window_start");`);
    this.addSql(`create index "agent_metric_rollups_tenant_org_idx" on "agent_metric_rollups" ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "agent_metric_rollups" cascade;`);
  }

}
