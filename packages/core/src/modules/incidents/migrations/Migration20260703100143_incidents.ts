import { Migration } from '@mikro-orm/migrations';

export class Migration20260703100143_incidents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "incident_runbooks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_runbooks_org_tenant_key_unique" on "incident_runbooks" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "incident_runbooks_org_tenant_idx" on "incident_runbooks" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_runbook_steps" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "runbook_id" uuid not null, "position" int not null, "title" text not null, "description" text null, "assignee_user_id" uuid null, "due_offset_minutes" int null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_runbook_steps_runbook_position_unique" on "incident_runbook_steps" ("runbook_id", "position") where "deleted_at" is null;`);
    this.addSql(`create index "incident_runbook_steps_runbook_idx" on "incident_runbook_steps" ("runbook_id");`);
    this.addSql(`create index "incident_runbook_steps_org_tenant_idx" on "incident_runbook_steps" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "incident_severities" add "default_runbook_id" uuid null;`);

    this.addSql(`alter table "incident_types" add "default_runbook_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "incident_severities" drop column "default_runbook_id";`);

    this.addSql(`alter table "incident_types" drop column "default_runbook_id";`);

    this.addSql(`drop table if exists "incident_runbook_steps" cascade;`);
    this.addSql(`drop table if exists "incident_runbooks" cascade;`);
  }

}
