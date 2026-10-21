import { Migration } from '@mikro-orm/migrations';

export class Migration20261019201834_customers extends Migration {

  override name = 'Migration20261019201834';

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_leads" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "stage_id" uuid not null, "outcome" text not null default 'open', "lost_reason_id" uuid null, "display_name" text not null, "owner_user_id" uuid null, "source" text null, "source_channel" text null, "source_external_id" text null, "source_payload_raw" jsonb null, "source_received_at" timestamptz null, "primary_email" text null, "primary_phone" text null, "vat_id" text null, "spam_score" numeric(5,2) null, "qualification_notes" text null, "person_data" jsonb null, "company_data" jsonb null, "deal_data" jsonb null, "created_person_id" uuid null, "created_company_id" uuid null, "created_deal_id" uuid null, "linked_person_id" uuid null, "linked_company_id" uuid null, "linked_deal_id" uuid null, "converted_at" timestamptz null, "converted_by_user_id" uuid null, "conversion_locked_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "customer_leads_vat_idx" on "customer_leads" ("organization_id", "tenant_id", "vat_id");`);
    this.addSql(`create index "customer_leads_phone_idx" on "customer_leads" ("organization_id", "tenant_id", "primary_phone");`);
    this.addSql(`create index "customer_leads_email_idx" on "customer_leads" ("organization_id", "tenant_id", "primary_email");`);
    this.addSql(`create index "customer_leads_outcome_idx" on "customer_leads" ("organization_id", "tenant_id", "outcome", "created_at");`);
    this.addSql(`create index "customer_leads_pipeline_stage_idx" on "customer_leads" ("organization_id", "tenant_id", "pipeline_id", "stage_id", "created_at");`);
    this.addSql(`create index "customer_leads_org_tenant_idx" on "customer_leads" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_lead_history" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "lead_id" uuid not null, "entry_type" text not null, "actor_user_id" uuid null, "message" text null, "payload" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "customer_lead_history_scope_idx" on "customer_lead_history" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_lead_history_lead_idx" on "customer_lead_history" ("lead_id", "created_at");`);

    this.addSql(`create table "customer_lead_lost_reasons" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid null, "name" text not null, "code" text not null, "is_active" boolean not null default true, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "customer_lead_lost_reasons_scope_idx" on "customer_lead_lost_reasons" ("organization_id", "tenant_id", "pipeline_id");`);

    this.addSql(`create table "customer_lead_pipelines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "is_default" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "customer_lead_pipelines_org_tenant_idx" on "customer_lead_pipelines" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "customer_lead_pipelines" add constraint "customer_lead_pipelines_code_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "customer_lead_pipeline_stages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "name" text not null, "code" text not null, "position" int not null default 0, "kind" text not null default 'open', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "customer_lead_pipeline_stages_scope_idx" on "customer_lead_pipeline_stages" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_lead_pipeline_stages_pipeline_idx" on "customer_lead_pipeline_stages" ("pipeline_id", "position");`);
    this.addSql(`alter table "customer_lead_pipeline_stages" add constraint "customer_lead_pipeline_stages_code_unique" unique ("pipeline_id", "code");`);

    this.addSql(`alter table "customer_settings" add "leads_enabled" boolean not null default true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_settings" drop column "leads_enabled";`);
    this.addSql(`drop table if exists "customer_lead_pipeline_stages";`);
    this.addSql(`drop table if exists "customer_lead_pipelines";`);
    this.addSql(`drop table if exists "customer_lead_lost_reasons";`);
    this.addSql(`drop table if exists "customer_lead_history";`);
    this.addSql(`drop table if exists "customer_leads";`);
  }

}
