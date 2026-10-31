import { Migration } from '@mikro-orm/migrations';

export class Migration20260703103816_incidents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "incident_service_components" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "component_type" text not null default 'service', "owner_team_id" uuid null, "owner_user_id" uuid null, "criticality" text not null default 'medium', "tier" text null, "slo_target_basis_points" int null, "source_type" text null, "source_id" text null, "snapshot" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "incident_service_components_source_idx" on "incident_service_components" ("organization_id", "tenant_id", "source_type", "source_id") where "deleted_at" is null and "source_type" is not null and "source_id" is not null;`);
    this.addSql(`create unique index "incident_service_components_org_tenant_key_unique" on "incident_service_components" ("organization_id", "tenant_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "incident_service_components_org_tenant_idx" on "incident_service_components" ("organization_id", "tenant_id");`);

    this.addSql(`create table "incident_service_dependencies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source_component_id" uuid not null, "target_component_id" uuid not null, "dependency_kind" text not null default 'depends_on', "snapshot" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "incident_service_dependencies_unique" on "incident_service_dependencies" ("organization_id", "tenant_id", "source_component_id", "target_component_id", "dependency_kind") where "deleted_at" is null;`);
    this.addSql(`create index "incident_service_dependencies_target_idx" on "incident_service_dependencies" ("target_component_id");`);
    this.addSql(`create index "incident_service_dependencies_source_idx" on "incident_service_dependencies" ("source_component_id");`);
    this.addSql(`create index "incident_service_dependencies_org_tenant_idx" on "incident_service_dependencies" ("organization_id", "tenant_id");`);
  }

}
