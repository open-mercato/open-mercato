import { Migration } from '@mikro-orm/migrations';

export class Migration20260306222921 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_deal_stage_histories" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "deal_id" uuid not null, "from_stage_id" uuid null, "to_stage_id" uuid not null, "from_stage_label" text null, "to_stage_label" text not null, "from_pipeline_id" uuid null, "to_pipeline_id" uuid not null, "changed_by_user_id" uuid null, "duration_seconds" int null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_deal_stage_histories_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_stage_histories_analytics_idx" on "customer_deal_stage_histories" ("organization_id", "tenant_id", "created_at", "to_stage_id");`);
    this.addSql(`create index "customer_deal_stage_histories_org_idx" on "customer_deal_stage_histories" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_deal_stage_histories_stage_idx" on "customer_deal_stage_histories" ("to_stage_id", "organization_id");`);
    this.addSql(`create index "customer_deal_stage_histories_deal_idx" on "customer_deal_stage_histories" ("deal_id", "created_at");`);

    this.addSql(`alter table "customer_deals" add column "close_reason_id" uuid null, add column "close_reason_notes" text null, add column "closed_at" timestamptz null, add column "stage_entered_at" timestamptz null, add column "last_activity_at" timestamptz null;`);
    this.addSql(`create index "customer_deals_org_owner_status_idx" on "customer_deals" ("organization_id", "tenant_id", "owner_user_id", "status");`);
    this.addSql(`create index "customer_deals_org_status_closed_idx" on "customer_deals" ("organization_id", "tenant_id", "status", "closed_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "customer_deals_org_owner_status_idx";`);
    this.addSql(`drop index "customer_deals_org_status_closed_idx";`);
    this.addSql(`alter table "customer_deals" drop column "close_reason_id", drop column "close_reason_notes", drop column "closed_at", drop column "stage_entered_at", drop column "last_activity_at";`);
  }

}
