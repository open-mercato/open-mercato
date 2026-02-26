import { Migration } from '@mikro-orm/migrations';

export class Migration20260226155449 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_pipelines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_pipelines_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_pipelines_org_tenant_idx" on "customer_pipelines" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_pipeline_stages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pipeline_id" uuid not null, "name" text not null, "position" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_pipeline_stages_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_pipeline_stages_org_tenant_idx" on "customer_pipeline_stages" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_pipeline_stages_pipeline_position_idx" on "customer_pipeline_stages" ("pipeline_id", "position");`);

    this.addSql(`alter table "customer_deals" add column "pipeline_id" uuid null, add column "pipeline_stage_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_deals" drop column "pipeline_id", drop column "pipeline_stage_id";`);
  }

}
