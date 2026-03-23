import { Migration } from '@mikro-orm/migrations';

export class Migration20260308071233 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_branches" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "company_entity_id" uuid not null, "name" text not null, "branch_type" text null, "specialization" text null, "budget" numeric(14,2) null, "headcount" int null, "responsible_person_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "customer_branches_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_branches_company_idx" on "customer_branches" ("company_entity_id");`);
    this.addSql(`create index "customer_branches_org_tenant_idx" on "customer_branches" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "customer_addresses" add column "branch_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_addresses" drop column "branch_id";`);
    this.addSql(`drop table if exists "customer_branches";`);
  }

}
