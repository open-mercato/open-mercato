import { Migration } from '@mikro-orm/migrations';

export class Migration20261019194556_financial extends Migration {

  override name = 'Migration20261019194556';

  override up(): void | Promise<void> {
    this.addSql(`create table "gl_bank_statements" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "cash_account_id" uuid not null, "file_name" text null, "period_start" date null, "period_end" date null, "status" text not null default 'imported', "imported_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "gl_bank_statements_account_idx" on "gl_bank_statements" ("organization_id", "cash_account_id");`);
    this.addSql(`create index "gl_bank_statements_tenant_org_idx" on "gl_bank_statements" ("tenant_id", "organization_id");`);

    this.addSql(`create table "gl_bank_statement_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "statement_id" uuid not null, "line_number" int not null default 0, "transaction_date" date not null, "description" text null, "reference" text null, "direction" text not null, "amount" numeric(18,4) not null default '0', "status" text not null default 'unmatched', "matched_entry_line_id" uuid null, "matched_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "gl_bank_statement_lines_status_idx" on "gl_bank_statement_lines" ("organization_id", "status");`);
    this.addSql(`create index "gl_bank_statement_lines_statement_idx" on "gl_bank_statement_lines" ("statement_id");`);

    this.addSql(`alter table "gl_bank_statements" add constraint "gl_bank_statements_status_check" check ("status" in ('imported', 'reconciled'));`);

    this.addSql(`alter table "gl_bank_statement_lines" add constraint "gl_bank_statement_lines_status_check" check ("status" in ('unmatched', 'matched', 'ignored'));`);
  }

}
