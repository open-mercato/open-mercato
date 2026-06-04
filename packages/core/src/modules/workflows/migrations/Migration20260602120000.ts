import { Migration } from '@mikro-orm/migrations';

export class Migration20260602120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "workflow_branch_instances" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "fork_step_id" varchar(100) not null, "join_step_id" varchar(100) not null, "branch_key" varchar(100) not null, "parent_branch_id" uuid null, "current_step_id" varchar(100) not null, "status" varchar(30) not null, "context_namespace" jsonb not null, "pending_transition" jsonb null, "error_message" text null, "error_details" jsonb null, "started_at" timestamptz null, "completed_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "workflow_branch_instances_pkey" primary key ("id"));`);
    this.addSql(`create index "workflow_branch_instances_tenant_org_idx" on "workflow_branch_instances" ("tenant_id", "organization_id");`);
    this.addSql(`create index "workflow_branch_instances_instance_fork_idx" on "workflow_branch_instances" ("workflow_instance_id", "fork_step_id");`);
    this.addSql(`create index "workflow_branch_instances_instance_status_idx" on "workflow_branch_instances" ("workflow_instance_id", "status");`);

    this.addSql(`alter table "workflow_instances" add column "active_fork_step_id" varchar(100) null;`);
    this.addSql(`alter table "step_instances" add column "branch_instance_id" uuid null;`);
    this.addSql(`alter table "user_tasks" add column "branch_instance_id" uuid null;`);
    this.addSql(`alter table "workflow_events" add column "branch_instance_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "workflow_events" drop column "branch_instance_id";`);
    this.addSql(`alter table "user_tasks" drop column "branch_instance_id";`);
    this.addSql(`alter table "step_instances" drop column "branch_instance_id";`);
    this.addSql(`alter table "workflow_instances" drop column "active_fork_step_id";`);
    this.addSql(`drop table if exists "workflow_branch_instances" cascade;`);
  }

}
