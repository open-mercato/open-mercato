import { Migration } from '@mikro-orm/migrations';

export class Migration20260701193911_incidents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "incident_escalation_policies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "steps" jsonb not null, "repeat_count" int not null default 0, "is_default" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_escalation_policies_org_tenant_key_unique" on "incident_escalation_policies" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "incident_escalation_policies_org_tenant_idx" on "incident_escalation_policies" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "incidents" add "escalation_policy_id" uuid null, add "escalation_status" text not null default 'inactive', add "escalation_repeats_done" int not null default 0, add "escalation_last_targets" jsonb null;`);

    this.addSql(`alter table "incident_settings" drop column "escalation_chain";`);
    this.addSql(`alter table "incident_settings" add "default_escalation_policy_id" uuid null;`);

    this.addSql(`alter table "incident_types" add "default_escalation_policy_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "incident_settings" drop column "default_escalation_policy_id";`);
    this.addSql(`alter table "incident_settings" add "escalation_chain" jsonb null;`);

    this.addSql(`alter table "incident_types" drop column "default_escalation_policy_id";`);

    this.addSql(`alter table "incidents" drop column "escalation_policy_id", drop column "escalation_status", drop column "escalation_repeats_done", drop column "escalation_last_targets";`);

    this.addSql(`drop table if exists "incident_escalation_policies";`);
  }

}
