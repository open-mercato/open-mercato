import { Migration } from '@mikro-orm/migrations'

// One exception to the append-only rule on `journal_entry_lines` (#5663, OQ-1
// in "Decisions on the review of 2026-10-26"): an UPDATE that changes only
// `contractor_snapshot` is let through, so `mercato entities
// rotate-encryption-key` can re-key the encrypted snapshot (it issues a plain
// UPDATE of that column) and the snapshot can be cleared after the retention
// period. Every other UPDATE and every DELETE still raises, as before.
//
// The lines get their own trigger function; `ledger_journal_entry_append_only()`
// and the trigger on `journal_entries` are unchanged. The deferred balance check
// (`journal_entry_lines_balanced`) also fires on such an UPDATE, and passes,
// because `debit` and `credit` cannot change through this exception.
export class Migration20261029120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create or replace function ledger_journal_entry_line_append_only() returns trigger as $$
      begin
        if tg_op = 'UPDATE'
           and (to_jsonb(new) - 'contractor_snapshot') is not distinct from (to_jsonb(old) - 'contractor_snapshot') then
          return new;
        end if;
        raise exception 'ledger: % on % is not permitted — journal entries are append-only', tg_op, tg_table_name;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`drop trigger if exists journal_entry_lines_append_only on "journal_entry_lines";`);
    this.addSql(`
      create trigger journal_entry_lines_append_only
        before update or delete on journal_entry_lines
        for each row
        execute procedure ledger_journal_entry_line_append_only();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists journal_entry_lines_append_only on "journal_entry_lines";`);
    this.addSql(`
      create trigger journal_entry_lines_append_only
        before update or delete on journal_entry_lines
        for each row
        execute procedure ledger_journal_entry_append_only();
    `);
    this.addSql(`drop function if exists ledger_journal_entry_line_append_only();`);
  }

}
