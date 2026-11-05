import { Migration } from '@mikro-orm/migrations';

export class Migration20260415135056 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_deal_stage_transitions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "stage_id" uuid not null, "stage_label" text not null, "stage_order" int not null, "transitioned_at" timestamptz not null, "transitioned_by_user_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "deal_id" uuid not null, constraint "customer_deal_stage_transitions_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_stage_transitions_org_tenant_idx" on "customer_deal_stage_transitions" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_deal_stage_transitions_deal_idx" on "customer_deal_stage_transitions" ("deal_id");`);
    this.addSql(`alter table "customer_deal_stage_transitions" add constraint "customer_deal_stage_transitions_deal_stage_uq" unique ("deal_id", "stage_id");`);

    this.addSql(`alter table "customer_deal_stage_transitions" add constraint "customer_deal_stage_transitions_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade;`);

    this.addSql(`create index "customer_deals_closure_stats_idx" on "customer_deals" ("organization_id", "tenant_id", "closure_outcome", "updated_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "customer_deals_closure_stats_idx";`);
    this.addSql(`alter table "customer_deal_stage_transitions" drop constraint "customer_deal_stage_transitions_deal_id_foreign";`);
    this.addSql(`drop table if exists "customer_deal_stage_transitions" cascade;`);
  }

}
