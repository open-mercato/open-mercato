import { Migration } from '@mikro-orm/migrations';

export class Migration20260718213629_production extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "production_mrp_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "status" text not null default 'pending', "params" jsonb null, "progress_job_id" uuid null, "started_at" timestamptz null, "finished_at" timestamptz null, "stats" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_mrp_runs_tenant_org_idx" on "production_mrp_runs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "production_mrp_suggestions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "run_id" uuid not null, "suggestion_type" text not null, "product_id" uuid not null, "variant_id" uuid null, "qty" numeric(18,6) not null, "uom" text not null, "due_date" timestamptz not null, "demand_source" jsonb null, "status" text not null default 'open', "carried_from_suggestion_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "production_mrp_suggestions_status_idx" on "production_mrp_suggestions" ("tenant_id", "organization_id", "status");`);
    this.addSql(`create index "production_mrp_suggestions_run_idx" on "production_mrp_suggestions" ("run_id");`);
    this.addSql(`create index "production_mrp_suggestions_tenant_org_idx" on "production_mrp_suggestions" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "production_mrp_runs" add constraint "production_mrp_runs_status_check" check ("status" in ('pending', 'running', 'completed', 'failed'));`);

    this.addSql(`alter table "production_mrp_suggestions" add constraint "production_mrp_suggestions_suggestion_type_check" check ("suggestion_type" in ('make', 'buy', 'reschedule', 'cancel'));`);
    this.addSql(`alter table "production_mrp_suggestions" add constraint "production_mrp_suggestions_status_check" check ("status" in ('open', 'accepted', 'dismissed', 'superseded'));`);
  }

}
