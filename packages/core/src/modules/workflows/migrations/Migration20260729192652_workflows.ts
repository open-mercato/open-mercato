import { Migration } from '@mikro-orm/migrations';

export class Migration20260729192652_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "workflow_definition_metric_rollups" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "workflow_id" varchar(100) not null, "window_key" varchar(10) not null, "window_start" timestamptz not null, "window_end" timestamptz not null, "computed_at" timestamptz not null, "metrics" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "workflow_definition_metric_rollups_lookup_idx" on "workflow_definition_metric_rollups" ("tenant_id", "organization_id", "workflow_id", "window_key");`);
    this.addSql(`alter table "workflow_definition_metric_rollups" add constraint "workflow_definition_metric_rollups_bucket_uq" unique ("tenant_id", "organization_id", "workflow_id", "window_key", "window_start");`);
  }

}
