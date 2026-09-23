import { Migration } from '@mikro-orm/migrations';

export class Migration20260922093649 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "fiscal_period" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "start_date" date not null, "end_date" date not null, "is_locked" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "fiscal_period_pkey" primary key ("id"));`);
    this.addSql(`create index "fiscal_period_scope_idx" on "fiscal_period" ("organization_id", "tenant_id");`);

    this.addSql(`create table "ledger_account_group" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "jurisdiction" text not null, "code" text not null, "name" text not null, "created_at" timestamptz not null, constraint "ledger_account_group_pkey" primary key ("id"));`);
    this.addSql(`create index "ledger_account_group_scope_idx" on "ledger_account_group" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "ledger_account_group" add constraint "ledger_account_group_scope_code_unique" unique ("organization_id", "tenant_id", "jurisdiction", "code");`);

    this.addSql(`create table "ledger_account_type" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "name" text not null, "normal_balance" text not null, "parent_account_type_id" uuid null, "account_group_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "ledger_account_type_pkey" primary key ("id"));`);
    this.addSql(`create index "ledger_account_type_scope_idx" on "ledger_account_type" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "ledger_account_type" add constraint "ledger_account_type_scope_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "ledger_account" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "account_type_id" uuid not null, "parent_account_id" uuid null, "description" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "ledger_account_pkey" primary key ("id"));`);
    this.addSql(`create index "ledger_account_scope_idx" on "ledger_account" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "ledger_account" add constraint "ledger_account_scope_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "journal_entry" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sequence_number" bigint not null, "posted_at" timestamptz not null, "operation_date" date not null, "document_type" text null, "document_number" text null, "document_date" date null, "description" text not null, "type" text not null default 'NORMAL', "currency_id" uuid not null, "exchange_rate" numeric(18,8) null, "reference_type" text null, "reference_id" uuid null, constraint "journal_entry_pkey" primary key ("id"));`);
    this.addSql(`create index "journal_entry_scope_idx" on "journal_entry" ("organization_id", "tenant_id");`);
    this.addSql(`create index "journal_entry_operation_date_idx" on "journal_entry" ("organization_id", "operation_date");`);
    this.addSql(`create index "journal_entry_posted_at_idx" on "journal_entry" ("organization_id", "posted_at");`);
    this.addSql(`create index "journal_entry_reference_idx" on "journal_entry" ("organization_id", "reference_type", "reference_id");`);
    this.addSql(`alter table "journal_entry" add constraint "journal_entry_sequence_unique" unique ("tenant_id", "organization_id", "sequence_number");`);

    // At most one entry may point at a given original via the
    // referenceType='journal_entry' pointer — i.e. an entry can be
    // reversed at most once. Partial so it constrains only this specific
    // reuse of the generic reference_type/reference_id pointer, not any
    // future referenceType. Backs the application-layer guard in
    // reverseJournalEntry.ts (PR #6340 review, M3).
    this.addSql(`create unique index "journal_entry_single_reversal_idx" on "journal_entry" ("reference_type", "reference_id") where "reference_type" = 'journal_entry' and "reference_id" is not null;`);

    this.addSql(`create table "journal_entry_line" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "journal_entry_id" uuid not null, "account_id" uuid not null, "debit" numeric(19,4) not null default 0, "credit" numeric(19,4) not null default 0, "amount_currency" numeric(19,4) not null default 0, "contractor_snapshot" json null, constraint "journal_entry_line_pkey" primary key ("id"));`);
    this.addSql(`create index "journal_entry_line_scope_idx" on "journal_entry_line" ("organization_id", "tenant_id");`);
    this.addSql(`create index "journal_entry_line_entry_idx" on "journal_entry_line" ("organization_id", "journal_entry_id");`);
    this.addSql(`create index "journal_entry_line_account_idx" on "journal_entry_line" ("organization_id", "account_id");`);
    // `assert_journal_entry_balanced()` (below) queries this table by
    // `journal_entry_id` alone, with no `organization_id` predicate — the
    // existing `journal_entry_line_entry_idx` above leads with
    // `organization_id`, so it can't serve that query. Without this, every
    // deferred balance check is a sequential scan of the whole table (PR
    // #6340 review, M9).
    this.addSql(`create index "journal_entry_line_journal_entry_idx" on "journal_entry_line" ("journal_entry_id");`);
    this.addSql(`alter table "journal_entry_line" add constraint "journal_entry_line_one_sided_chk" check (("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0));`);

    // No cascade: this repo's append-only design (see the guard triggers
    // below) means a `journal_entry` row is never legitimately deleted, so
    // there is nothing for a cascade to do — the default RESTRICT-like
    // behavior is what we want (PR #6340 review, m6).
    this.addSql(`alter table "journal_entry_line" add constraint "journal_entry_line_journal_entry_fk" foreign key ("journal_entry_id") references "journal_entry" ("id");`);

    this.addSql(`create table "journal_entry_sequence" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "next_value" bigint not null default 1, "created_at" timestamptz not null, constraint "journal_entry_sequence_pkey" primary key ("id"));`);
    this.addSql(`alter table "journal_entry_sequence" add constraint "journal_entry_sequence_scope_unique" unique ("organization_id", "tenant_id");`);

    // Deferred balance-check constraint trigger. First migration in this
    // repo to create a Postgres function/constraint trigger — see
    // .ai/specs/2026-08-18-general-ledger-core-engine.md § Migration
    // ("corrected 2026-09-18"): a failed deferred-trigger check surfaces
    // at commit as a generic Postgres error, which `postJournalEntry`
    // must catch and translate to a readable application error.
    this.addSql(`
      create or replace function assert_journal_entry_balanced() returns trigger as $$
      declare
        target_journal_entry_id uuid;
        total_debit numeric(19,4);
        total_credit numeric(19,4);
      begin
        -- PR #6340 review, m6: the trigger now also fires on DELETE (a row
        -- removed mid-transaction can leave the remaining lines unbalanced
        -- just as an insert/update can), and NEW is null on a DELETE event,
        -- so the id must come from OLD in that case.
        target_journal_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);

        select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
          into total_debit, total_credit
          from journal_entry_line
          where journal_entry_id = target_journal_entry_id;
        if total_debit <> total_credit then
          raise exception 'journal_entry_line: unbalanced journal entry % (debit % <> credit %)', target_journal_entry_id, total_debit, total_credit;
        end if;
        return null;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create constraint trigger journal_entry_line_balanced
        after insert or update or delete on journal_entry_line
        deferrable initially deferred
        for each row
        execute procedure assert_journal_entry_balanced();
    `);

    // PR #6340 review, m6: this module's design is append-only — no
    // legitimate code path anywhere in `ledger` ever updates or deletes a
    // posted `journal_entry`/`journal_entry_line` row (confirmed by
    // grepping the module's commands). These triggers turn that design
    // assumption into a DB-level guarantee rather than leaving it as an
    // unenforced convention.
    this.addSql(`
      create or replace function ledger_journal_entry_append_only() returns trigger as $$
      begin
        raise exception 'ledger: % on % is not permitted — journal entries are append-only', tg_op, tg_table_name;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger journal_entry_append_only
        before update or delete on journal_entry
        for each row
        execute procedure ledger_journal_entry_append_only();
    `);
    this.addSql(`
      create trigger journal_entry_line_append_only
        before update or delete on journal_entry_line
        for each row
        execute procedure ledger_journal_entry_append_only();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists journal_entry_line_append_only on "journal_entry_line";`);
    this.addSql(`drop trigger if exists journal_entry_append_only on "journal_entry";`);
    this.addSql(`drop function if exists ledger_journal_entry_append_only();`);

    this.addSql(`drop trigger if exists journal_entry_line_balanced on "journal_entry_line";`);
    this.addSql(`drop function if exists assert_journal_entry_balanced();`);

    this.addSql(`alter table "journal_entry_line" drop constraint if exists "journal_entry_line_journal_entry_fk";`);

    this.addSql(`drop table if exists "journal_entry_sequence" cascade;`);
    this.addSql(`drop table if exists "journal_entry_line" cascade;`);
    this.addSql(`drop table if exists "journal_entry" cascade;`);
    this.addSql(`drop table if exists "ledger_account" cascade;`);
    this.addSql(`drop table if exists "ledger_account_type" cascade;`);
    this.addSql(`drop table if exists "ledger_account_group" cascade;`);
    this.addSql(`drop table if exists "fiscal_period" cascade;`);
  }

}
