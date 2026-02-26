import { Migration } from '@mikro-orm/migrations';

export class Migration20260220214819 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "progress_jobs" ("id" uuid not null default gen_random_uuid(), "job_type" text not null, "name" text not null, "description" text null, "status" text not null default 'pending', "progress_percent" smallint not null default 0, "processed_count" int not null default 0, "total_count" int null, "eta_seconds" int null, "started_by_user_id" uuid null, "started_at" timestamptz null, "heartbeat_at" timestamptz null, "finished_at" timestamptz null, "result_summary" jsonb null, "error_message" text null, "error_stack" text null, "meta" jsonb null, "cancellable" boolean not null default false, "cancelled_by_user_id" uuid null, "cancel_requested_at" timestamptz null, "parent_job_id" uuid null, "partition_index" int null, "partition_count" int null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "progress_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index "progress_jobs_parent_idx" on "progress_jobs" ("parent_job_id");`);
    this.addSql(`create index "progress_jobs_type_tenant_idx" on "progress_jobs" ("job_type", "tenant_id");`);
    this.addSql(`create index "progress_jobs_status_tenant_idx" on "progress_jobs" ("status", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "progress_jobs";`);
  }
}
