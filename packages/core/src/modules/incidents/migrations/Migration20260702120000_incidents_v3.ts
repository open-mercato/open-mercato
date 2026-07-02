import { Migration } from '@mikro-orm/migrations';

export class Migration20260702120000_incidents_v3 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "incident_triggers" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "event_id" text not null, "is_enabled" boolean not null default true, "severity_key" text null, "type_key" text null, "escalation_policy_id" uuid null, "conditions" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_triggers_org_tenant_event_unique" on "incident_triggers" ("organization_id", "tenant_id", "event_id") where "deleted_at" is null;`);
    this.addSql(`create index "incident_triggers_org_tenant_event_enabled_idx" on "incident_triggers" ("organization_id", "tenant_id", "event_id", "is_enabled") where "deleted_at" is null;`);

    this.addSql(`alter table "incidents" add "next_update_due_at" timestamptz null, add "update_overdue_notified_at" timestamptz null;`);
    this.addSql(`alter table "incident_settings" add "update_cadence" jsonb null;`);

    this.addSql(`
      insert into "incident_triggers" ("organization_id", "tenant_id", "event_id", "is_enabled", "severity_key", "type_key", "conditions", "created_at", "updated_at", "deleted_at")
      select
        "settings"."organization_id",
        "settings"."tenant_id",
        "legacy"."key",
        coalesce(("legacy"."value"->>'enabled')::boolean, false),
        "legacy"."value"->>'severity_key',
        "legacy"."value"->>'type_key',
        case
          when "legacy"."key" = 'integrations.state.updated'
            then '[{"path":"reauthRequired","equals":true}]'::jsonb
          else null
        end,
        now(),
        now(),
        null
      from "incident_settings" as "settings"
      cross join lateral jsonb_each(coalesce("settings"."auto_incident_triggers", '{}'::jsonb)) as "legacy"("key", "value")
      where "settings"."auto_incident_triggers" is not null
      on conflict ("organization_id", "tenant_id", "event_id") where "deleted_at" is null do nothing;
    `);

    this.addSql(`alter table "incident_settings" drop column "auto_incident_triggers";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "incident_settings" add "auto_incident_triggers" jsonb null;`);

    this.addSql(`
      update "incident_settings" as "settings"
      set "auto_incident_triggers" = "legacy"."triggers"
      from (
        select
          "organization_id",
          "tenant_id",
          jsonb_object_agg(
            "event_id",
            jsonb_build_object(
              'enabled', "is_enabled",
              'severity_key', "severity_key",
              'type_key', "type_key"
            )
          ) as "triggers"
        from "incident_triggers"
        where "deleted_at" is null
        group by "organization_id", "tenant_id"
      ) as "legacy"
      where "settings"."organization_id" = "legacy"."organization_id"
        and "settings"."tenant_id" = "legacy"."tenant_id";
    `);

    this.addSql(`alter table "incident_settings" drop column "update_cadence";`);
    this.addSql(`alter table "incidents" drop column "next_update_due_at", drop column "update_overdue_notified_at";`);
    this.addSql(`drop table if exists "incident_triggers";`);
  }

}
