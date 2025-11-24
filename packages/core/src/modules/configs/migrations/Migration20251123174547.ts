import { Migration } from '@mikro-orm/migrations';

export class Migration20251123174547 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "upgrade_action_runs" ("id" uuid not null default gen_random_uuid(), "version" text not null, "action_id" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "completed_at" timestamptz not null, "created_at" timestamptz not null, constraint "upgrade_action_runs_pkey" primary key ("id"));`);
    this.addSql(`create index "upgrade_action_runs_scope_idx" on "upgrade_action_runs" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "upgrade_action_runs" add constraint "upgrade_action_runs_action_scope_unique" unique ("version", "action_id", "organization_id", "tenant_id");`);
  }

}
