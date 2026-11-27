import { Migration } from '@mikro-orm/migrations'

export class Migration20261120155115_example extends Migration {
  override up(): void {
    this.addSql(`create table "example_todo_brands" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "host_id" uuid not null, "brand" text null, "updated_at" timestamptz not null, primary key ("id"));`)
    this.addSql(`alter table "example_todo_brands" add constraint "example_todo_brands_tenant_id_organization_id_host_id_unique" unique ("tenant_id", "organization_id", "host_id");`)
    this.addSql(`create table "example_todo_erp_links" ("id" uuid not null default gen_random_uuid(), "sync_status" text not null default 'pending', "sync_attempts" int not null default 0, "next_attempt_at" timestamptz null, "last_attempt_at" timestamptz null, "last_error_code" text null, "external_id" text null, "delivery_revision" bigint not null, "delivery_integration_id" text not null, "delivery_contract_id" text not null, "idempotency_key" text not null, "pending_operation" text not null, "delivery_actor_id" uuid null, "failure_reports" jsonb not null default '[]', "next_failure_report_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid not null, "host_id" uuid not null, "values" jsonb null, "updated_at" timestamptz not null, primary key ("id"));`)
    this.addSql(`alter table "example_todo_erp_links" add constraint "example_todo_erp_links_tenant_id_organization_id_host_id_unique" unique ("tenant_id", "organization_id", "host_id");`)
  }

  override down(): void {
    this.addSql(`drop table if exists "example_todo_erp_links";`)
    this.addSql(`drop table if exists "example_todo_brands";`)
  }
}
