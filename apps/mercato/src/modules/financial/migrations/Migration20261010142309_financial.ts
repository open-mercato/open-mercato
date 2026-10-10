import { Migration } from '@mikro-orm/migrations';

export class Migration20261010142309_financial extends Migration {

  override name = 'Migration20261010142309';

  override up(): void | Promise<void> {
    this.addSql(`create table "gl_cash_accounts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "kind" text not null default 'cash', "account_id" uuid not null, "currency_code" text not null, "bank_name" text null, "iban" text null, "account_number" text null, "is_active" boolean not null default true, "is_default" boolean not null default false, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "gl_cash_accounts_code_unique_idx" on "gl_cash_accounts" ("organization_id", "tenant_id", "code") where deleted_at is null;`);
    this.addSql(`create index "gl_cash_accounts_tenant_org_idx" on "gl_cash_accounts" ("tenant_id", "organization_id");`);

    this.addSql(`create table "gl_payment_methods" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "kind" text not null default 'other', "account_id" uuid not null, "is_active" boolean not null default true, "is_default" boolean not null default false, "requires_reference" boolean not null default false, "sort_order" int not null default 0, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "gl_payment_methods_code_unique_idx" on "gl_payment_methods" ("organization_id", "tenant_id", "code") where deleted_at is null;`);
    this.addSql(`create index "gl_payment_methods_tenant_org_idx" on "gl_payment_methods" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "gl_journal_entries" drop constraint if exists "gl_journal_entries_entry_type_check";`);
    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_entry_type_check" check ("entry_type" in ('standard', 'adjusting', 'closing', 'reversing', 'opening'));`);

    this.addSql(`alter table "gl_cash_accounts" add constraint "gl_cash_accounts_kind_check" check ("kind" in ('cash', 'bank'));`);

    this.addSql(`alter table "gl_payment_methods" add constraint "gl_payment_methods_kind_check" check ("kind" in ('cash', 'bank_transfer', 'card', 'cheque', 'wallet', 'other'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "gl_journal_entries" drop constraint if exists "gl_journal_entries_entry_type_check";`);
    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_entry_type_check" check ("entry_type" in ('standard', 'adjusting', 'closing', 'reversing'));`);

    // Hand-added: the generator's `down` reverted only the widened CHECK and left
    // both new tables behind, so a rollback would keep the tables while the
    // snapshot and the entities said they were gone.
    this.addSql(`drop table if exists "gl_payment_methods" cascade;`);
    this.addSql(`drop table if exists "gl_cash_accounts" cascade;`);
  }

}
