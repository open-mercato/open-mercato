import { Migration } from '@mikro-orm/migrations';

export class Migration20260505100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "data_quality_checks" ("id" uuid not null default gen_random_uuid(), "code" varchar(100) not null, "name" varchar(200) not null, "description" text null, "target_entity_type" varchar(100) not null, "failure_expression" jsonb not null, "severity" text not null, "weight" integer not null default 1, "enabled" boolean not null default true, "created_by" varchar(50) null, "updated_by" varchar(50) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "data_quality_checks_pkey" primary key ("id"));`);
    this.addSql(`create unique index "data_quality_checks_code_unique" on "data_quality_checks" ("tenant_id", "organization_id", "code");`);
    this.addSql(`create index "data_quality_checks_target_enabled_idx" on "data_quality_checks" ("tenant_id", "organization_id", "target_entity_type", "enabled");`);
    this.addSql(`create index "data_quality_checks_severity_idx" on "data_quality_checks" ("tenant_id", "organization_id", "severity");`);

    this.addSql(`create table "data_quality_suites" ("id" uuid not null default gen_random_uuid(), "code" varchar(100) not null, "name" varchar(200) not null, "description" text null, "enabled" boolean not null default true, "created_by" varchar(50) null, "updated_by" varchar(50) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "data_quality_suites_pkey" primary key ("id"));`);
    this.addSql(`create unique index "data_quality_suites_code_unique" on "data_quality_suites" ("tenant_id", "organization_id", "code");`);
    this.addSql(`create index "data_quality_suites_enabled_idx" on "data_quality_suites" ("tenant_id", "organization_id", "enabled");`);

    this.addSql(`create table "data_quality_suite_checks" ("id" uuid not null default gen_random_uuid(), "suite_id" uuid not null, "check_id" uuid not null, "sequence" integer not null default 0, "enabled" boolean not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "data_quality_suite_checks_pkey" primary key ("id"));`);
    this.addSql(`create unique index "data_quality_suite_checks_unique" on "data_quality_suite_checks" ("tenant_id", "organization_id", "suite_id", "check_id");`);
    this.addSql(`create index "data_quality_suite_checks_seq_idx" on "data_quality_suite_checks" ("tenant_id", "organization_id", "suite_id", "sequence");`);

    this.addSql(`create table "data_quality_scan_runs" ("id" uuid not null default gen_random_uuid(), "suite_id" uuid null, "target_entity_type" varchar(100) null, "status" text not null, "progress_job_id" uuid null, "criteria_json" jsonb null, "total_count" integer not null default 0, "scanned_count" integer not null default 0, "failed_count" integer not null default 0, "finding_count" integer not null default 0, "open_finding_count" integer not null default 0, "score" real null, "error_message" text null, "requested_by" varchar(50) null, "tenant_id" uuid not null, "organization_id" uuid not null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "data_quality_scan_runs_pkey" primary key ("id"));`);
    this.addSql(`create index "data_quality_scan_runs_status_idx" on "data_quality_scan_runs" ("tenant_id", "organization_id", "status", "created_at");`);
    this.addSql(`create index "data_quality_scan_runs_suite_idx" on "data_quality_scan_runs" ("tenant_id", "organization_id", "suite_id", "created_at");`);
    this.addSql(`create index "data_quality_scan_runs_target_idx" on "data_quality_scan_runs" ("tenant_id", "organization_id", "target_entity_type", "created_at");`);

    this.addSql(`create table "data_quality_findings" ("id" uuid not null default gen_random_uuid(), "check_id" uuid not null, "scan_run_id" uuid null, "target_entity_type" varchar(100) not null, "target_record_id" varchar(100) not null, "fingerprint" varchar(128) not null, "status" text not null, "severity" text not null, "message" varchar(500) not null, "details_json" jsonb null, "first_seen_at" timestamptz not null, "last_seen_at" timestamptz not null, "resolved_at" timestamptz null, "ignored_at" timestamptz null, "resolved_by" varchar(50) null, "ignored_by" varchar(50) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "data_quality_findings_pkey" primary key ("id"));`);
    this.addSql(`create unique index "data_quality_findings_fingerprint_unique" on "data_quality_findings" ("tenant_id", "organization_id", "fingerprint");`);
    this.addSql(`create index "data_quality_findings_status_severity_idx" on "data_quality_findings" ("tenant_id", "organization_id", "status", "severity");`);
    this.addSql(`create index "data_quality_findings_target_record_idx" on "data_quality_findings" ("tenant_id", "organization_id", "target_entity_type", "target_record_id");`);
    this.addSql(`create index "data_quality_findings_check_status_idx" on "data_quality_findings" ("tenant_id", "organization_id", "check_id", "status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "data_quality_findings";`);
    this.addSql(`drop table if exists "data_quality_scan_runs";`);
    this.addSql(`drop table if exists "data_quality_suite_checks";`);
    this.addSql(`drop table if exists "data_quality_suites";`);
    this.addSql(`drop table if exists "data_quality_checks";`);
  }
}
