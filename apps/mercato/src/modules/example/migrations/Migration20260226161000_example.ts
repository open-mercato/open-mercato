import { Migration } from '@mikro-orm/migrations';

export class Migration20260226161000_example extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "example_customer_priorities" ("id" uuid not null default gen_random_uuid(), "customer_id" uuid not null, "priority" text not null default 'normal', "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "example_customer_priorities_pkey" primary key ("id"));`);
    this.addSql(`create index "example_customer_priorities_customer_idx" on "example_customer_priorities" ("customer_id");`);
    this.addSql(`create index "example_customer_priorities_org_tenant_idx" on "example_customer_priorities" ("organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "example_customer_priorities" cascade;`);
  }

}
