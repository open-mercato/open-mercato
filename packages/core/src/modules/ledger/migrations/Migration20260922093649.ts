import { Migration } from '@mikro-orm/migrations';

export class Migration20260922093649 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "fiscal_periods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "start_date" date not null, "end_date" date not null, "is_locked" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "fiscal_periods_pkey" primary key ("id"));`);
    this.addSql(`create index "fiscal_periods_scope_idx" on "fiscal_periods" ("organization_id", "tenant_id");`);

    this.addSql(`create table "ledger_account_groups" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "jurisdiction" text not null, "code" text not null, "name" text not null, "created_at" timestamptz not null, constraint "ledger_account_groups_pkey" primary key ("id"));`);
    this.addSql(`create index "ledger_account_groups_scope_idx" on "ledger_account_groups" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "ledger_account_groups" add constraint "ledger_account_groups_scope_code_unique" unique ("organization_id", "tenant_id", "jurisdiction", "code");`);

    this.addSql(`create table "ledger_account_types" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "name" text not null, "normal_balance" text not null, "parent_account_type_id" uuid null, "account_group_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "ledger_account_types_pkey" primary key ("id"));`);
    this.addSql(`create index "ledger_account_types_scope_idx" on "ledger_account_types" ("organization_id", "tenant_id");`);
    // PR #6340 review, n4: a plain table `unique` constraint can't carry a
    // `where` predicate in Postgres, so this was originally
    // `alter table ... add constraint ... unique (...)`, meaning a
    // soft-deleted account type's slug stayed reserved forever — deleting
    // "misc" and creating a new "misc" would fail with a duplicate-slug
    // error even though the old row is gone from every real listing. A
    // partial unique INDEX (not a constraint) is the only way to scope
    // this to live rows in Postgres. Since the whole module is still
    // unreleased on this branch, this edits the one existing migration in
    // place (same rationale as n3's own migration edit above).
    this.addSql(`create unique index "ledger_account_types_scope_slug_unique" on "ledger_account_types" ("organization_id", "tenant_id", "slug") where "deleted_at" is null;`);

    this.addSql(`create table "ledger_accounts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "account_type_id" uuid not null, "parent_account_id" uuid null, "description" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "ledger_accounts_pkey" primary key ("id"));`);
    this.addSql(`create index "ledger_accounts_scope_idx" on "ledger_accounts" ("organization_id", "tenant_id");`);
    // PR #6340 review, n4: same fix as `ledger_account_types_scope_slug_unique`
    // above — a soft-deleted account's slug must be reusable, which a plain
    // table `unique` constraint (no `where` support in Postgres) cannot
    // express. Replaced with a partial unique index scoped to live rows.
    this.addSql(`create unique index "ledger_accounts_scope_slug_unique" on "ledger_accounts" ("organization_id", "tenant_id", "slug") where "deleted_at" is null;`);

    this.addSql(`create table "journal_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sequence_number" bigint not null, "posted_at" timestamptz not null, "operation_date" date not null, "document_type" text null, "document_number" text null, "document_date" date null, "description" text not null, "type" text not null default 'NORMAL', "currency_id" uuid not null, "exchange_rate" numeric(18,8) null, "reference_type" text null, "reference_id" uuid null, constraint "journal_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "journal_entries_scope_idx" on "journal_entries" ("organization_id", "tenant_id");`);
    this.addSql(`create index "journal_entries_operation_date_idx" on "journal_entries" ("organization_id", "operation_date");`);
    this.addSql(`create index "journal_entries_posted_at_idx" on "journal_entries" ("organization_id", "posted_at");`);
    this.addSql(`create index "journal_entries_reference_idx" on "journal_entries" ("organization_id", "reference_type", "reference_id");`);
    this.addSql(`alter table "journal_entries" add constraint "journal_entries_sequence_unique" unique ("tenant_id", "organization_id", "sequence_number");`);

    // At most one entry may point at a given original via the
    // referenceType='journal_entry' pointer — i.e. an entry can be
    // reversed at most once. Partial so it constrains only this specific
    // reuse of the generic reference_type/reference_id pointer, not any
    // future referenceType. Backs the application-layer guard in
    // reverseJournalEntry.ts (PR #6340 review, M3). Predicate tightened
    // (PR #6340 review, n3) to also require type = 'REVERSAL': the
    // original predicate let any entry type occupy a reference_id's slot
    // in this index, so a non-reversal entry that happened to carry
    // reference_type='journal_entry'/reference_id=<id> (impossible for
    // postJournalEntry callers as of n3's schema restriction, but not
    // something this DB constraint should have to rely on) would make
    // <id> permanently unreversible. Since the whole module is still
    // unreleased on this branch, this edits the one existing migration in
    // place rather than adding a new one (matching this PR's own prior
    // review-round commits: 8fe194a5b, 5e97f9a61, 38fb797ce all amended
    // this same file).
    this.addSql(`create unique index "journal_entries_single_reversal_idx" on "journal_entries" ("reference_type", "reference_id") where "type" = 'REVERSAL' and "reference_type" = 'journal_entry' and "reference_id" is not null;`);

    this.addSql(`create table "journal_entry_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "journal_entry_id" uuid not null, "account_id" uuid not null, "debit" numeric(19,4) not null default 0, "credit" numeric(19,4) not null default 0, "amount_currency" numeric(19,4) not null default 0, "contractor_snapshot" json null, constraint "journal_entry_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "journal_entry_lines_scope_idx" on "journal_entry_lines" ("organization_id", "tenant_id");`);
    this.addSql(`create index "journal_entry_lines_entry_idx" on "journal_entry_lines" ("organization_id", "journal_entry_id");`);
    this.addSql(`create index "journal_entry_lines_account_idx" on "journal_entry_lines" ("organization_id", "account_id");`);
    // `assert_journal_entry_balanced()` (below) queries this table by
    // `journal_entry_id` alone, with no `organization_id` predicate — the
    // existing `journal_entry_lines_entry_idx` above leads with
    // `organization_id`, so it can't serve that query. Without this, every
    // deferred balance check is a sequential scan of the whole table (PR
    // #6340 review, M9).
    this.addSql(`create index "journal_entry_lines_journal_entry_idx" on "journal_entry_lines" ("journal_entry_id");`);
    this.addSql(`alter table "journal_entry_lines" add constraint "journal_entry_lines_one_sided_chk" check (("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0));`);

    // No cascade: this repo's append-only design (see the guard triggers
    // below) means a `journal_entry` row is never legitimately deleted, so
    // there is nothing for a cascade to do — the default RESTRICT-like
    // behavior is what we want (PR #6340 review, m6).
    this.addSql(`alter table "journal_entry_lines" add constraint "journal_entry_lines_journal_entry_fk" foreign key ("journal_entry_id") references "journal_entries" ("id");`);

    this.addSql(`create table "journal_entry_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "next_value" bigint not null default 1, "created_at" timestamptz not null, constraint "journal_entry_sequences_pkey" primary key ("id"));`);
    this.addSql(`alter table "journal_entry_sequences" add constraint "journal_entry_sequences_scope_unique" unique ("organization_id", "tenant_id");`);

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
          from journal_entry_lines
          where journal_entry_id = target_journal_entry_id;
        if total_debit <> total_credit then
          raise exception 'journal_entry_line: unbalanced journal entry % (debit % <> credit %)', target_journal_entry_id, total_debit, total_credit;
        end if;
        return null;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create constraint trigger journal_entry_lines_balanced
        after insert or update or delete on journal_entry_lines
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
      create trigger journal_entries_append_only
        before update or delete on journal_entries
        for each row
        execute procedure ledger_journal_entry_append_only();
    `);
    this.addSql(`
      create trigger journal_entry_lines_append_only
        before update or delete on journal_entry_lines
        for each row
        execute procedure ledger_journal_entry_append_only();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists journal_entry_lines_append_only on "journal_entry_lines";`);
    this.addSql(`drop trigger if exists journal_entries_append_only on "journal_entries";`);
    this.addSql(`drop function if exists ledger_journal_entry_append_only();`);

    this.addSql(`drop trigger if exists journal_entry_lines_balanced on "journal_entry_lines";`);
    this.addSql(`drop function if exists assert_journal_entry_balanced();`);

    this.addSql(`alter table "journal_entry_lines" drop constraint if exists "journal_entry_lines_journal_entry_fk";`);

    this.addSql(`drop table if exists "journal_entry_sequences" cascade;`);
    this.addSql(`drop table if exists "journal_entry_lines" cascade;`);
    this.addSql(`drop table if exists "journal_entries" cascade;`);
    this.addSql(`drop table if exists "ledger_accounts" cascade;`);
    this.addSql(`drop table if exists "ledger_account_types" cascade;`);
    this.addSql(`drop table if exists "ledger_account_groups" cascade;`);
    this.addSql(`drop table if exists "fiscal_periods" cascade;`);
  }

}
