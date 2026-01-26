import { Migration } from '@mikro-orm/migrations';

export class Migration20260126100000 extends Migration {

  override async up(): Promise<void> {
    // Add new fields to scheduled_job_runs table for BullMQ integration
    this.addSql(`alter table "scheduled_job_runs" add column if not exists "payload" jsonb null;`);
    this.addSql(`alter table "scheduled_job_runs" add column if not exists "queue_job_id" text null;`);
    this.addSql(`alter table "scheduled_job_runs" add column if not exists "queue_name" text null;`);
    this.addSql(`alter table "scheduled_job_runs" add column if not exists "error_stack" text null;`);
    this.addSql(`alter table "scheduled_job_runs" add column if not exists "duration_ms" int null;`);
    
    // Add index for queue job lookups
    this.addSql(`create index if not exists "scheduled_job_runs_queue_job_idx" on "scheduled_job_runs" ("queue_job_id", "queue_name");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "scheduled_job_runs_queue_job_idx";`);
    this.addSql(`alter table "scheduled_job_runs" drop column if exists "duration_ms";`);
    this.addSql(`alter table "scheduled_job_runs" drop column if exists "error_stack";`);
    this.addSql(`alter table "scheduled_job_runs" drop column if exists "queue_name";`);
    this.addSql(`alter table "scheduled_job_runs" drop column if exists "queue_job_id";`);
    this.addSql(`alter table "scheduled_job_runs" drop column if exists "payload";`);
  }

}
