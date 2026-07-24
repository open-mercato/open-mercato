import { Migration } from '@mikro-orm/migrations';

export class Migration20260701122956_incidents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "incidents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "number" text not null, "title" text not null, "description" text null, "incident_type_id" uuid null, "severity_id" uuid not null, "priority" text null, "status" text not null, "visibility" text not null default 'internal', "is_drill" boolean not null default false, "is_major" boolean not null default false, "owner_user_id" uuid null, "owning_team_id" uuid null, "reporter_user_id" uuid not null, "detected_at" timestamptz null, "acknowledged_at" timestamptz null, "started_at" timestamptz null, "resolved_at" timestamptz null, "closed_at" timestamptz null, "escalation_level" int not null default 0, "next_escalation_at" timestamptz null, "snoozed_until" timestamptz null, "sla_response_due_at" timestamptz null, "sla_resolution_due_at" timestamptz null, "sla_at_risk" boolean not null default false, "sla_breached" boolean not null default false, "merged_into_incident_id" uuid null, "source_event_ref" text null, "customer_impact_summary" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incidents_org_tenant_source_event_ref_unique" on "incidents" ("organization_id", "tenant_id", "source_event_ref") where "deleted_at" is null and "source_event_ref" is not null;`);
    this.addSql(`create unique index "incidents_org_tenant_number_unique" on "incidents" ("organization_id", "tenant_id", "number") where "deleted_at" is null;`);
    this.addSql(`create index "incidents_org_tenant_idx" on "incidents" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_action_items" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "incident_id" uuid not null, "title" text not null, "description" text null, "assignee_user_id" uuid null, "status" text not null default 'open', "due_at" timestamptz null, "completed_at" timestamptz null, "external_ref" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "incident_action_items_incident_idx" on "incident_action_items" ("incident_id");`);
    this.addSql(`create index "incident_action_items_org_tenant_idx" on "incident_action_items" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_impacts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "incident_id" uuid not null, "target_type" text not null, "target_id" uuid null, "component_label" text null, "impact_status" text not null default 'operational', "snapshot" jsonb null, "revenue_amount_minor" bigint null, "revenue_currency" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_impacts_target_unique" on "incident_impacts" ("incident_id", "target_type", (coalesce("target_id"::text, "component_label"))) where "deleted_at" is null;`);
    this.addSql(`create index "incident_impacts_incident_target_type_idx" on "incident_impacts" ("incident_id", "target_type");`);
    this.addSql(`create index "incident_impacts_org_tenant_idx" on "incident_impacts" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "incident_id" uuid not null, "linked_incident_id" uuid not null, "kind" text not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_links_incident_linked_kind_unique" on "incident_links" ("incident_id", "linked_incident_id", "kind") where "deleted_at" is null;`);
    this.addSql(`create index "incident_links_org_tenant_idx" on "incident_links" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_number_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "current_value" bigint not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "incident_number_sequences" add constraint "incident_number_sequences_org_tenant_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_participants" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "incident_id" uuid not null, "user_id" uuid not null, "kind" text not null, "role_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_participants_incident_user_kind_unique" on "incident_participants" ("incident_id", "user_id", "kind") where "deleted_at" is null;`);
    this.addSql(`create index "incident_participants_org_tenant_idx" on "incident_participants" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_postmortems" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "incident_id" uuid not null, "summary" text null, "root_cause" text null, "impact" text null, "contributing_factors" text null, "lessons" text null, "status" text not null default 'draft', "published_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_postmortems_incident_unique" on "incident_postmortems" ("incident_id") where "deleted_at" is null;`);
    this.addSql(`create index "incident_postmortems_org_tenant_idx" on "incident_postmortems" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_roles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "label" text not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_roles_org_tenant_key_unique" on "incident_roles" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "incident_roles_org_tenant_idx" on "incident_roles" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "number_format" text not null, "ack_timeout_minutes" int null, "escalation_timeout_minutes" int null, "escalation_chain" jsonb null, "sla_targets" jsonb null, "auto_incident_triggers" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_settings_org_tenant_unique" on "incident_settings" ("organization_id", "tenant_id") where "deleted_at" is null;`);

    this.addSql(`create table "incident_severities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "label" text not null, "rank" int not null, "color_token" text not null, "is_default" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_severities_org_tenant_key_unique" on "incident_severities" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "incident_severities_org_tenant_idx" on "incident_severities" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_timeline_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "incident_id" uuid not null, "kind" text not null, "actor_user_id" uuid null, "body" text null, "visibility" text not null default 'internal', "metadata" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "incident_timeline_entries_incident_idx" on "incident_timeline_entries" ("incident_id");`);
    this.addSql(`create index "incident_timeline_entries_org_tenant_idx" on "incident_timeline_entries" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_types" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "label" text not null, "default_severity_id" uuid null, "default_role_ids" jsonb null, "required_fields_on_resolve" jsonb null, "is_default" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_types_org_tenant_key_unique" on "incident_types" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "incident_types_org_tenant_idx" on "incident_types" ("organization_id", "tenant_id");`);
  }

}
