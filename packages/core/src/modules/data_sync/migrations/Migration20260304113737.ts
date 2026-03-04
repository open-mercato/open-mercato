import { Migration } from '@mikro-orm/migrations';

export class Migration20260304113737 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sync_cursors" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "direction" text not null, "cursor" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "updated_at" timestamptz not null, constraint "sync_cursors_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_cursors_integration_id_entity_type_direction__b4d87_index" on "sync_cursors" ("integration_id", "entity_type", "direction", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_mappings" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "mapping" jsonb not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sync_mappings_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_mappings_integration_id_entity_type_organizat_edee9_index" on "sync_mappings" ("integration_id", "entity_type", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_runs" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "direction" text not null, "status" text not null, "cursor" text null, "initial_cursor" text null, "created_count" int not null default 0, "updated_count" int not null default 0, "skipped_count" int not null default 0, "failed_count" int not null default 0, "batches_completed" int not null default 0, "last_error" text null, "progress_job_id" uuid null, "job_id" text null, "triggered_by" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sync_runs_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_runs_integration_id_entity_type_status_organi_8b13b_index" on "sync_runs" ("integration_id", "entity_type", "status", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_schedules" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "entity_type" text not null, "direction" text not null, "schedule_type" text not null, "schedule_value" text not null, "timezone" text not null default 'UTC', "full_sync" boolean not null default false, "is_enabled" boolean not null default true, "scheduled_job_id" uuid null, "last_run_at" timestamptz null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sync_schedules_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_schedules_integration_id_entity_type_directio_addb9_index" on "sync_schedules" ("integration_id", "entity_type", "direction", "organization_id", "tenant_id");`);
  }

}
