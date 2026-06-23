import { Migration } from '@mikro-orm/migrations';

export class Migration20260619152534 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "customer_leads" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "status" text not null default 'open', "source" text null, "estimated_value_amount" numeric(14,2) null, "estimated_value_currency" text null, "company_name" text null, "company_vat_id" text null, "contact_first_name" text null, "contact_last_name" text null, "contact_phone" text null, "contact_email" text null, "created_deal_id" uuid null, "created_person_entity_id" uuid null, "created_company_entity_id" uuid null, "converted_at" timestamptz null, "converted_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "customer_leads_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "customer_leads_org_tenant_converted_idx" on "customer_leads" ("organization_id", "tenant_id", "converted_at");`);
    this.addSql(`create index if not exists "customer_leads_org_tenant_created_idx" on "customer_leads" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`create index if not exists "customer_leads_org_tenant_status_created_idx" on "customer_leads" ("organization_id", "tenant_id", "status", "created_at");`);
  }

}
