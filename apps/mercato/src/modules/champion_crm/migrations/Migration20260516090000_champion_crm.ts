import { Migration } from '@mikro-orm/migrations'

export class Migration20260516090000_champion_crm extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "champion_crm_leads" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source" text null, "source_external_id" text null, "source_payload" jsonb not null default '{}'::jsonb, "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "utm_term" text null, "utm_content" text null, "email_normalized" text null, "phone_e164" text null, "name_raw" text null, "tech_status" text not null default 'new', "qualification_status" text not null default 'do_kwalifikacji', "disqualification_reason" text null, "contact_id" uuid null, "deal_id" uuid null, "owner_user_id" uuid null, "qualified_at" timestamptz null, "disqualified_at" timestamptz null, "last_attempt_at" timestamptz null, "next_followup_at" timestamptz null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "champion_crm_leads_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_leads_scope_status_idx" on "champion_crm_leads" ("organization_id", "tenant_id", "tech_status");`)
    this.addSql(`create index "champion_crm_leads_email_idx" on "champion_crm_leads" ("organization_id", "tenant_id", "email_normalized");`)
    this.addSql(`create index "champion_crm_leads_phone_idx" on "champion_crm_leads" ("organization_id", "tenant_id", "phone_e164");`)
    this.addSql(`create index "champion_crm_leads_contact_idx" on "champion_crm_leads" ("contact_id");`)
    this.addSql(`create unique index "champion_crm_leads_source_external_unique" on "champion_crm_leads" ("organization_id", "tenant_id", "source", "source_external_id") where "source_external_id" is not null and "deleted_at" is null;`)

    this.addSql(`create table "champion_crm_contacts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "first_name" text null, "last_name" text null, "display_name" text not null, "primary_email" text null, "primary_phone_e164" text null, "emails" jsonb not null default '[]'::jsonb, "phones" jsonb not null default '[]'::jsonb, "lifecycle" text not null default 'lead', "owner_user_id" uuid null, "first_lead_id" uuid null, "last_lead_id" uuid null, "last_lead_at" timestamptz null, "last_lead_source" text null, "consent_summary" jsonb not null default '{}'::jsonb, "score" int not null default 0, "internal_alert" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "champion_crm_contacts_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_contacts_scope_lifecycle_idx" on "champion_crm_contacts" ("organization_id", "tenant_id", "lifecycle");`)
    this.addSql(`create index "champion_crm_contacts_email_idx" on "champion_crm_contacts" ("organization_id", "tenant_id", "primary_email");`)
    this.addSql(`create index "champion_crm_contacts_phone_idx" on "champion_crm_contacts" ("organization_id", "tenant_id", "primary_phone_e164");`)

    this.addSql(`create table "champion_crm_deals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "contact_id" uuid not null, "lead_id" uuid null, "investment_id" uuid null, "apartment_id" uuid null, "title" text not null, "status" text not null default 'open', "stage" text null, "budget_amount" numeric(16,2) null, "budget_currency" text null, "expected_close_at" timestamptz null, "closed_at" timestamptz null, "probability" int not null default 0, "loss_reason" text null, "owner_user_id" uuid null, "metadata" jsonb not null default '{}'::jsonb, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "champion_crm_deals_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_deals_scope_status_idx" on "champion_crm_deals" ("organization_id", "tenant_id", "status");`)
    this.addSql(`create index "champion_crm_deals_contact_idx" on "champion_crm_deals" ("contact_id");`)
    this.addSql(`create index "champion_crm_deals_investment_idx" on "champion_crm_deals" ("investment_id");`)

    this.addSql(`create table "champion_crm_investments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "status" text not null default 'planned', "description" text null, "city" text null, "address" text null, "sales_start_at" timestamptz null, "sales_end_at" timestamptz null, "metadata" jsonb not null default '{}'::jsonb, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "champion_crm_investments_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_investments_scope_status_idx" on "champion_crm_investments" ("organization_id", "tenant_id", "status");`)

    this.addSql(`create table "champion_crm_apartments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "investment_id" uuid not null, "unit_number" text not null, "building" text null, "floor" text null, "rooms" int null, "area_sqm" numeric(10,2) null, "price_amount" numeric(16,2) null, "price_currency" text null, "status" text not null default 'available', "reserved_by_deal_id" uuid null, "reserved_at" timestamptz null, "metadata" jsonb not null default '{}'::jsonb, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "champion_crm_apartments_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_apartments_scope_status_idx" on "champion_crm_apartments" ("organization_id", "tenant_id", "status");`)
    this.addSql(`create index "champion_crm_apartments_investment_idx" on "champion_crm_apartments" ("investment_id");`)
    this.addSql(`create unique index "champion_crm_apartments_unit_unique" on "champion_crm_apartments" ("organization_id", "tenant_id", "investment_id", "unit_number") where "deleted_at" is null;`)

    this.addSql(`create table "champion_crm_activities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "entity_type" text not null, "entity_id" uuid not null, "contact_id" uuid null, "lead_id" uuid null, "deal_id" uuid null, "type" text not null, "title" text not null, "body" text null, "occurred_at" timestamptz not null, "due_at" timestamptz null, "created_by_user_id" uuid null, "owner_user_id" uuid null, "metadata" jsonb not null default '{}'::jsonb, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "champion_crm_activities_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_activities_scope_idx" on "champion_crm_activities" ("organization_id", "tenant_id");`)
    this.addSql(`create index "champion_crm_activities_entity_idx" on "champion_crm_activities" ("entity_type", "entity_id");`)
    this.addSql(`create index "champion_crm_activities_lead_idx" on "champion_crm_activities" ("lead_id");`)
    this.addSql(`create index "champion_crm_activities_contact_idx" on "champion_crm_activities" ("contact_id");`)

    this.addSql(`create table "champion_crm_consent_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "contact_id" uuid null, "lead_id" uuid null, "scope" text not null, "granted" boolean not null, "text_version" text null, "source" text null, "captured_at" timestamptz not null, "evidence" jsonb not null default '{}'::jsonb, "created_at" timestamptz not null, constraint "champion_crm_consent_events_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_consent_events_scope_idx" on "champion_crm_consent_events" ("organization_id", "tenant_id");`)
    this.addSql(`create index "champion_crm_consent_events_contact_idx" on "champion_crm_consent_events" ("contact_id");`)
    this.addSql(`create index "champion_crm_consent_events_lead_idx" on "champion_crm_consent_events" ("lead_id");`)

    this.addSql(`create table "champion_crm_audit_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "entity_type" text not null, "entity_id" uuid not null, "action" text not null, "actor_user_id" uuid null, "message" text null, "metadata" jsonb not null default '{}'::jsonb, "created_at" timestamptz not null, constraint "champion_crm_audit_events_pkey" primary key ("id"));`)
    this.addSql(`create index "champion_crm_audit_events_scope_idx" on "champion_crm_audit_events" ("organization_id", "tenant_id");`)
    this.addSql(`create index "champion_crm_audit_events_entity_idx" on "champion_crm_audit_events" ("entity_type", "entity_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "champion_crm_audit_events" cascade;`)
    this.addSql(`drop table if exists "champion_crm_consent_events" cascade;`)
    this.addSql(`drop table if exists "champion_crm_activities" cascade;`)
    this.addSql(`drop table if exists "champion_crm_apartments" cascade;`)
    this.addSql(`drop table if exists "champion_crm_investments" cascade;`)
    this.addSql(`drop table if exists "champion_crm_deals" cascade;`)
    this.addSql(`drop table if exists "champion_crm_contacts" cascade;`)
    this.addSql(`drop table if exists "champion_crm_leads" cascade;`)
  }
}
