import { Migration } from '@mikro-orm/migrations';

export class Migration20260304113737 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "integration_credentials" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "credentials" jsonb not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "integration_credentials_pkey" primary key ("id"));`);
    this.addSql(`create index "integration_credentials_integration_id_organizatio_291ea_index" on "integration_credentials" ("integration_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "integration_logs" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "run_id" uuid null, "scope_entity_type" text null, "scope_entity_id" uuid null, "level" text not null, "message" text not null, "code" text null, "payload" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, constraint "integration_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "integration_logs_level_organization_id_tenant_id_c_107e7_index" on "integration_logs" ("level", "organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index "integration_logs_integration_id_organization_id_te_38189_index" on "integration_logs" ("integration_id", "organization_id", "tenant_id", "created_at");`);

    this.addSql(`create table "integration_states" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "is_enabled" boolean not null default true, "api_version" text null, "reauth_required" boolean not null default false, "last_health_status" text null, "last_health_checked_at" timestamptz null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "integration_states_pkey" primary key ("id"));`);
    this.addSql(`create index "integration_states_integration_id_organization_id__32acc_index" on "integration_states" ("integration_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sync_external_id_mappings" ("id" uuid not null default gen_random_uuid(), "integration_id" text not null, "internal_entity_type" text not null, "internal_entity_id" uuid not null, "external_id" text not null, "sync_status" text not null default 'not_synced', "last_synced_at" timestamptz null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sync_external_id_mappings_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_external_id_mappings_integration_id_external__c088c_index" on "sync_external_id_mappings" ("integration_id", "external_id", "organization_id");`);
    this.addSql(`create index "sync_external_id_mappings_internal_entity_type_int_f9194_index" on "sync_external_id_mappings" ("internal_entity_type", "internal_entity_id", "organization_id");`);
  }

}
