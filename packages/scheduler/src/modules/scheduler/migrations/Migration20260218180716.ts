import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "scheduled_jobs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid null, "scope_type" text not null default 'tenant', "name" text not null, "description" text null, "schedule_type" text not null, "schedule_value" text not null, "timezone" text not null default 'UTC', "target_type" text not null, "target_queue" text null, "target_command" text null, "target_payload" jsonb null, "require_feature" text null, "is_enabled" boolean not null default true, "last_run_at" timestamptz null, "next_run_at" timestamptz null, "source_type" text not null default 'user', "source_module" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, "created_by_user_id" uuid null, "updated_by_user_id" uuid null, constraint "scheduled_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index "scheduled_jobs_scope_idx" on "scheduled_jobs" ("scope_type", "is_enabled");`);
    this.addSql(`create index "scheduled_jobs_next_run_idx" on "scheduled_jobs" ("next_run_at");`);
    this.addSql(`create index "scheduled_jobs_org_tenant_idx" on "scheduled_jobs" ("organization_id", "tenant_id");`);
  }

}
