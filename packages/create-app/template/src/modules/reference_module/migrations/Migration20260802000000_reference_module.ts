import { Migration } from '@mikro-orm/migrations'

export class Migration20260802000000_reference_module extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "reference_module_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "title" text not null, "description" text null, "status" text not null default 'todo', "priority" smallint not null default 0, "due_at" timestamptz null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "reference_module_tasks_pkey" primary key ("id"), constraint "reference_module_tasks_status_check" check ("status" in ('todo', 'in_progress', 'done')), constraint "reference_module_tasks_priority_check" check ("priority" between 0 and 5));`)
    this.addSql(`create index "reference_module_tasks_scope_deleted_idx" on "reference_module_tasks" ("tenant_id", "organization_id", "deleted_at");`)
    this.addSql(`create index "reference_module_tasks_scope_status_idx" on "reference_module_tasks" ("tenant_id", "organization_id", "status");`)
    this.addSql(`create index "reference_module_tasks_scope_due_idx" on "reference_module_tasks" ("tenant_id", "organization_id", "due_at");`)

    this.addSql(`create table "reference_module_task_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "target_kind" text not null, "target_id" uuid not null, "target_label_snapshot" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "reference_module_task_links_pkey" primary key ("id"), constraint "reference_module_task_links_target_kind_check" check ("target_kind" in ('customer', 'catalog_product', 'sales_document')), constraint "reference_module_task_links_task_id_foreign" foreign key ("task_id") references "reference_module_tasks" ("id") on update cascade on delete cascade);`)
    this.addSql(`create index "reference_module_task_links_scope_task_idx" on "reference_module_task_links" ("tenant_id", "organization_id", "task_id");`)
    this.addSql(`create index "reference_module_task_links_scope_target_idx" on "reference_module_task_links" ("tenant_id", "organization_id", "target_kind", "target_id");`)
    this.addSql(`create unique index "reference_module_task_links_active_unique" on "reference_module_task_links" ("tenant_id", "organization_id", "task_id", "target_kind", "target_id") where "deleted_at" is null;`)

    this.addSql(`create table "reference_module_task_undo_snapshots" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "command_id" uuid not null, "command_type" text not null, "payload" text not null, "expected_version" timestamptz not null, "created_at" timestamptz not null, "expires_at" timestamptz not null, "consumed_at" timestamptz null, constraint "reference_module_task_undo_snapshots_pkey" primary key ("id"), constraint "reference_module_task_undo_snapshots_task_id_foreign" foreign key ("task_id") references "reference_module_tasks" ("id") on update cascade on delete cascade);`)
    this.addSql(`create index "reference_module_task_undo_scope_task_idx" on "reference_module_task_undo_snapshots" ("tenant_id", "organization_id", "task_id");`)
    this.addSql(`create index "reference_module_task_undo_expiry_idx" on "reference_module_task_undo_snapshots" ("expires_at", "consumed_at");`)
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "reference_module_task_undo_snapshots" cascade;')
    this.addSql('drop table if exists "reference_module_task_links" cascade;')
    this.addSql('drop table if exists "reference_module_tasks" cascade;')
  }
}
