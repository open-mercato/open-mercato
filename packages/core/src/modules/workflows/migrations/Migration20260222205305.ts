import { Migration } from '@mikro-orm/migrations';

export class Migration20260222205305 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "workflow_event_triggers" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "description" text null, "workflow_definition_id" uuid not null, "event_pattern" varchar(255) not null, "config" jsonb null, "enabled" boolean not null default true, "priority" int not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(255) null, "updated_by" varchar(255) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "workflow_event_triggers_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "workflow_event_triggers_enabled_priority_idx" on "workflow_event_triggers" ("enabled", "priority");`);
    this.addSql(`create index if not exists "workflow_event_triggers_tenant_org_idx" on "workflow_event_triggers" ("tenant_id", "organization_id");`);
    this.addSql(`create index if not exists "workflow_event_triggers_definition_idx" on "workflow_event_triggers" ("workflow_definition_id");`);
    this.addSql(`create index if not exists "workflow_event_triggers_event_pattern_idx" on "workflow_event_triggers" ("event_pattern", "enabled");`);
  }

}
