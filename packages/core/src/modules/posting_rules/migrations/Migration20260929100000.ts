import { Migration } from '@mikro-orm/migrations';

export class Migration20260929100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "posting_rules_cost_centers" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "posting_rules_cost_centers_pkey" primary key ("id"));`);
    this.addSql(`create index "posting_rules_cost_centers_scope_idx" on "posting_rules_cost_centers" ("organization_id", "tenant_id");`);
    // A plain table `unique` constraint can't carry a `where` predicate in
    // Postgres, so a soft-deleted cost centre's code must stay reusable via a
    // partial unique index (matching ledger's own
    // `ledger_account_types_scope_slug_unique` precedent), not a table
    // constraint.
    this.addSql(`create unique index "posting_rules_cost_centers_scope_code_unique" on "posting_rules_cost_centers" ("organization_id", "tenant_id", "code") where "deleted_at" is null;`);

    this.addSql(`create table "posting_rules_default_account_posting_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source_account_id" uuid not null, "target_account_id" uuid not null, "default_cost_center_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "posting_rules_default_account_posting_rules_pkey" primary key ("id"));`);
    this.addSql(`create index "posting_rules_default_account_posting_rules_scope_idx" on "posting_rules_default_account_posting_rules" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "posting_rules_default_account_posting_rules" add constraint "posting_rules_default_account_posting_rules_source_unique" unique ("organization_id", "tenant_id", "source_account_id");`);

    this.addSql(`create table "posting_rules_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "clearing_account_id" uuid null, "unallocated_cost_account_id" uuid null, "updated_at" timestamptz not null, constraint "posting_rules_settings_pkey" primary key ("id"));`);
    this.addSql(`alter table "posting_rules_settings" add constraint "posting_rules_settings_scope_unique" unique ("organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "posting_rules_settings" cascade;`);
    this.addSql(`drop table if exists "posting_rules_default_account_posting_rules" cascade;`);
    this.addSql(`drop table if exists "posting_rules_cost_centers" cascade;`);
  }

}
