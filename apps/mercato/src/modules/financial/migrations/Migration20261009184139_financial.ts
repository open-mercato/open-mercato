import { Migration } from '@mikro-orm/migrations';

export class Migration20261009184139_financial extends Migration {

  override name = 'Migration20261009184139';

  override up(): void | Promise<void> {
    this.addSql(`create table "gl_accounts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "description" text null, "account_class" text not null, "account_type" text null, "parent_id" uuid null, "currency_code" text not null, "normal_balance" text not null, "is_active" boolean not null default true, "is_reconciliation_required" boolean not null default false, "country_code" text null, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "gl_accounts_code_unique_idx" on "gl_accounts" ("organization_id", "tenant_id", "code") where deleted_at is null;`);
    this.addSql(`create index "gl_accounts_class_idx" on "gl_accounts" ("organization_id", "account_class");`);
    this.addSql(`create index "gl_accounts_tenant_org_idx" on "gl_accounts" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "gl_accounts" add constraint "gl_accounts_account_class_check" check ("account_class" in ('asset', 'liability', 'equity', 'revenue', 'expense'));`);
    this.addSql(`alter table "gl_accounts" add constraint "gl_accounts_normal_balance_check" check ("normal_balance" in ('debit', 'credit'));`);

    this.addSql(`create table "gl_periods" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "fiscal_year" int not null, "period_number" int not null, "period_name" text not null, "start_date" date not null, "end_date" date not null, "status" text not null default 'open', "closed_at" timestamptz null, "closed_by" uuid null, "balance_snapshot" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "gl_periods_unique_idx" on "gl_periods" ("organization_id", "tenant_id", "fiscal_year", "period_number");`);
    this.addSql(`create index "gl_periods_tenant_org_idx" on "gl_periods" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "gl_periods" add constraint "gl_periods_status_check" check ("status" in ('open', 'soft_closed', 'hard_closed'));`);

    this.addSql(`create table "gl_journal_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "entry_number" text not null, "entry_date" date not null, "posting_date" date not null, "period_id" uuid not null, "entry_type" text not null default 'standard', "description" text not null, "reference" text null, "currency_code" text not null, "exchange_rate" numeric(19,6) not null default '1', "status" text not null default 'draft', "reverses_entry_id" uuid null, "reversed_by_entry_id" uuid null, "posted_at" timestamptz null, "posted_by" uuid null, "created_by" uuid null, "updated_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "gl_journal_entries_number_unique_idx" on "gl_journal_entries" ("organization_id", "tenant_id", "entry_number");`);
    this.addSql(`create index "gl_journal_entries_period_idx" on "gl_journal_entries" ("period_id", "status");`);
    this.addSql(`create index "gl_journal_entries_tenant_org_idx" on "gl_journal_entries" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_entry_type_check" check ("entry_type" in ('standard', 'adjusting', 'closing', 'reversing'));`);
    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_status_check" check ("status" in ('draft', 'posted', 'reversed'));`);

    this.addSql(`create table "gl_journal_lines" ("id" uuid not null default gen_random_uuid(), "entry_id" uuid not null, "line_number" int not null, "account_id" uuid not null, "description" text null, "debit_amount" numeric(19,4) not null default '0', "credit_amount" numeric(19,4) not null default '0', "base_debit_amount" numeric(19,4) not null default '0', "base_credit_amount" numeric(19,4) not null default '0', "tax_code" text null, "cost_center_id" uuid null, "project_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "gl_journal_lines_account_idx" on "gl_journal_lines" ("account_id");`);
    this.addSql(`create index "gl_journal_lines_entry_idx" on "gl_journal_lines" ("entry_id");`);

    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_period_id_foreign" foreign key ("period_id") references "gl_periods" ("id");`);
    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_reverses_entry_id_foreign" foreign key ("reverses_entry_id") references "gl_journal_entries" ("id") on delete set null;`);
    this.addSql(`alter table "gl_journal_entries" add constraint "gl_journal_entries_reversed_by_entry_id_foreign" foreign key ("reversed_by_entry_id") references "gl_journal_entries" ("id") on delete set null;`);

    this.addSql(`alter table "gl_journal_lines" add constraint "gl_journal_lines_entry_id_foreign" foreign key ("entry_id") references "gl_journal_entries" ("id");`);
    this.addSql(`alter table "gl_journal_lines" add constraint "gl_journal_lines_account_id_foreign" foreign key ("account_id") references "gl_accounts" ("id");`);
  }

}
