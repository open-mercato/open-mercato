import { Migration } from '@mikro-orm/migrations';

export class Migration20260929130000 extends Migration {

  override async up(): Promise<void> {
    // `journal_entry_line_id` is a plain FK-id to `ledger.journal_entry_lines`,
    // no DB-level FOREIGN KEY constraint and no ORM relation — matching root
    // AGENTS.md's "no direct ORM relationships between modules" rule
    // (precedent: `journal_entry_lines.account_id`, itself a plain FK-id to
    // `ledger_accounts` with no relation). `dimension_id` is `text`, not
    // `uuid`: the one advertised dimension type with a real, shipped target
    // entity ('Currency') is identified by ISO code, not a uuid.
    this.addSql(`create table "journal_entry_line_dimensions" ("id" uuid not null default gen_random_uuid(), "journal_entry_line_id" uuid not null, "dimension_type" text not null, "dimension_id" text not null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, constraint "journal_entry_line_dimensions_pkey" primary key ("id"));`);

    // The only query shape this module serves today: `setJournalEntryLineDimension`
    // deletes by this pair, and every consumer read filters by this same pair
    // (plus tenant/org).
    this.addSql(`create index "journal_entry_line_dimensions_line_type_idx" on "journal_entry_line_dimensions" ("journal_entry_line_id", "dimension_type");`);

    // Integrity, not a query shape (distinct in purpose from the index
    // above): makes a duplicate `dimensionId` within one call, or the same
    // call retried, a no-op via `on conflict do nothing` on the command's
    // insert step, instead of a second identical row for the same tag.
    this.addSql(`alter table "journal_entry_line_dimensions" add constraint "journal_entry_line_dimensions_unique" unique ("journal_entry_line_id", "dimension_type", "dimension_id", "tenant_id", "organization_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "journal_entry_line_dimensions" cascade;`);
  }

}
