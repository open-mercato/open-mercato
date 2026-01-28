import { Migration } from '@mikro-orm/migrations'

/**
 * Drop scheduled_job_runs table
 * 
 * The scheduler module now uses BullMQ as the single source of truth for execution history.
 * Run records are no longer stored in the database.
 */
export class Migration20260126143000 extends Migration {
  async up(): Promise<void> {
    // Drop the scheduled_job_runs table
    this.addSql(`drop table if exists "scheduled_job_runs" cascade;`)
  }

  async down(): Promise<void> {
    // Recreate the table structure (without data)
    this.addSql(`create table "scheduled_job_runs" ("id" uuid not null default gen_random_uuid(), "scheduled_job_id" uuid not null, "organization_id" uuid null, "tenant_id" uuid null, "started_at" timestamptz not null default now(), "finished_at" timestamptz null, "status" text not null default 'running', "trigger_type" text not null default 'scheduled', "triggered_by_user_id" uuid null, "error_message" text null, "result_payload" jsonb null, "payload" jsonb null, "queue_job_id" text null, "queue_name" text null, "error_stack" text null, "duration_ms" int null, constraint "scheduled_job_runs_pkey" primary key ("id"));`)
    this.addSql(`create index "scheduled_job_runs_job_idx" on "scheduled_job_runs" ("scheduled_job_id", "started_at");`)
    this.addSql(`create index "scheduled_job_runs_cleanup_idx" on "scheduled_job_runs" ("started_at");`)
    this.addSql(`create index "scheduled_job_runs_queue_job_idx" on "scheduled_job_runs" ("queue_job_id", "queue_name");`)
  }
}
