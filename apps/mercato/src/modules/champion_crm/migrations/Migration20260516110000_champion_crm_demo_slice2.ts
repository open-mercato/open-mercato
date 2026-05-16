import { Migration } from '@mikro-orm/migrations'

export class Migration20260516110000_champion_crm_demo_slice2 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "champion_crm_leads" add column if not exists "api_idempotency_key" text null;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "form_type" text null;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "message" text null;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "investment_id" uuid null;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "qualification_status_changed_at" timestamptz null;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "qualification_history" jsonb not null default '[]'::jsonb;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "submitted_at" timestamptz null;`)
    this.addSql(`alter table "champion_crm_leads" add column if not exists "received_at" timestamptz null;`)
    this.addSql(`create index if not exists "champion_crm_leads_investment_idx" on "champion_crm_leads" ("investment_id");`)

    this.addSql(`alter table "champion_crm_deals" add column if not exists "source_lead_id" uuid null;`)
    this.addSql(`alter table "champion_crm_deals" add column if not exists "deal_number" text null;`)
    this.addSql(`alter table "champion_crm_deals" add column if not exists "stage_changed_at" timestamptz null;`)
    this.addSql(`alter table "champion_crm_deals" add column if not exists "value_gross" numeric(16,2) null;`)
    this.addSql(`alter table "champion_crm_deals" add column if not exists "currency" text null;`)
    this.addSql(`alter table "champion_crm_deals" add column if not exists "won_at" timestamptz null;`)
    this.addSql(`create index if not exists "champion_crm_deals_source_lead_idx" on "champion_crm_deals" ("source_lead_id");`)
    this.addSql(`create unique index if not exists "champion_crm_deals_number_unique" on "champion_crm_deals" ("organization_id", "tenant_id", "deal_number") where "deal_number" is not null and "deleted_at" is null;`)

    this.addSql(`alter table "champion_crm_investments" add column if not exists "slug" text null;`)
    this.addSql(`alter table "champion_crm_investments" add column if not exists "description_short" text null;`)
    this.addSql(`alter table "champion_crm_investments" add column if not exists "address_line1" text null;`)
    this.addSql(`alter table "champion_crm_investments" add column if not exists "price_min" numeric(16,2) null;`)
    this.addSql(`alter table "champion_crm_investments" add column if not exists "price_max" numeric(16,2) null;`)
    this.addSql(`alter table "champion_crm_investments" add column if not exists "currency" text null;`)
    this.addSql(`create unique index if not exists "champion_crm_investments_slug_unique" on "champion_crm_investments" ("organization_id", "tenant_id", "slug") where "slug" is not null and "deleted_at" is null;`)

    this.addSql(`alter table "champion_crm_apartments" add column if not exists "type" text null;`)
    this.addSql(`alter table "champion_crm_apartments" add column if not exists "list_price_gross" numeric(16,2) null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "champion_crm_investments_slug_unique";`)
    this.addSql(`drop index if exists "champion_crm_deals_number_unique";`)
    this.addSql(`drop index if exists "champion_crm_deals_source_lead_idx";`)
    this.addSql(`drop index if exists "champion_crm_leads_investment_idx";`)

    this.addSql(`alter table "champion_crm_apartments" drop column if exists "list_price_gross";`)
    this.addSql(`alter table "champion_crm_apartments" drop column if exists "type";`)

    this.addSql(`alter table "champion_crm_investments" drop column if exists "currency";`)
    this.addSql(`alter table "champion_crm_investments" drop column if exists "price_max";`)
    this.addSql(`alter table "champion_crm_investments" drop column if exists "price_min";`)
    this.addSql(`alter table "champion_crm_investments" drop column if exists "address_line1";`)
    this.addSql(`alter table "champion_crm_investments" drop column if exists "description_short";`)
    this.addSql(`alter table "champion_crm_investments" drop column if exists "slug";`)

    this.addSql(`alter table "champion_crm_deals" drop column if exists "won_at";`)
    this.addSql(`alter table "champion_crm_deals" drop column if exists "currency";`)
    this.addSql(`alter table "champion_crm_deals" drop column if exists "value_gross";`)
    this.addSql(`alter table "champion_crm_deals" drop column if exists "stage_changed_at";`)
    this.addSql(`alter table "champion_crm_deals" drop column if exists "deal_number";`)
    this.addSql(`alter table "champion_crm_deals" drop column if exists "source_lead_id";`)

    this.addSql(`alter table "champion_crm_leads" drop column if exists "received_at";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "submitted_at";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "qualification_history";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "qualification_status_changed_at";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "investment_id";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "message";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "form_type";`)
    this.addSql(`alter table "champion_crm_leads" drop column if exists "api_idempotency_key";`)
  }
}
