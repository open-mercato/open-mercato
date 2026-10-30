import { Migration } from '@mikro-orm/migrations'

// Currency, exchange rate and original amount on every journal entry line
// (#5663 / #6340), added after the first three migrations had been reviewed.
//
//  - `journal_entry_lines.currency_id` and `exchange_rate` are NOT NULL (the
//    rate is base-currency units per one unit of the line's currency, 1 on a
//    base-currency line) with `exchange_rate > 0`; `amount_currency` keeps its
//    column and gains `>= 0` (an unsigned magnitude: 0 is allowed for an
//    exchange-difference line). `debit`/`credit` stay in the base currency, so
//    the deferred balance trigger is untouched.
//  - `ledger_accounts.currency_id` is nullable: set only on an account kept in
//    one currency (a bank account), null everywhere else.
//
// Existing lines are backfilled from their entry's header: currency from
// `journal_entries.currency_id`, rate from `journal_entries.exchange_rate`
// (1 when the header has none), and `amount_currency` from `debit + credit`
// divided by that rate when it was still the default 0. The append-only trigger
// on the lines blocks UPDATE, so it is lifted for the backfill only and put back
// in the same transaction, and the deferred balance check is forced to run before the
// columns are tightened. Only review databases can hold rows here: the module
// is not merged.
export class Migration20261023110000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "ledger_accounts" add column "currency_id" uuid null;`);

    this.addSql(`alter table "journal_entry_lines" add column "currency_id" uuid null;`);
    this.addSql(`alter table "journal_entry_lines" add column "exchange_rate" numeric(18,8) null;`);

    this.addSql(`alter table "journal_entry_lines" disable trigger "journal_entry_lines_append_only";`);
    this.addSql(`
      update "journal_entry_lines" as l
         set "currency_id" = e."currency_id",
             "exchange_rate" = coalesce(e."exchange_rate", 1),
             "amount_currency" = case
               when l."amount_currency" > 0 then l."amount_currency"
               else round((l."debit" + l."credit") / coalesce(e."exchange_rate", 1), 4)
             end
        from "journal_entries" as e
       where e."id" = l."journal_entry_id";
    `);
    // The update queued deferred balance checks; Postgres refuses ALTER TABLE
    // while events are pending, so run them now (the entries stay balanced:
    // only non-amount columns changed), then put the append-only trigger back.
    this.addSql(`set constraints "journal_entry_lines_balanced" immediate;`);
    this.addSql(`alter table "journal_entry_lines" enable trigger "journal_entry_lines_append_only";`);

    this.addSql(`alter table "journal_entry_lines" alter column "currency_id" set not null;`);
    this.addSql(`alter table "journal_entry_lines" alter column "exchange_rate" set not null;`);
    this.addSql(`alter table "journal_entry_lines" add constraint "journal_entry_lines_rate_positive_chk" check ("exchange_rate" > 0);`);
    this.addSql(`alter table "journal_entry_lines" add constraint "journal_entry_lines_amount_currency_nonneg_chk" check ("amount_currency" >= 0);`);
  }

  // The schema is reversed; the backfill is not. Lines whose `amount_currency` was
  // the default 0 keep the recomputed value, because the migration does not record
  // which lines had 0 before.
  override async down(): Promise<void> {
    this.addSql(`alter table "journal_entry_lines" drop constraint "journal_entry_lines_amount_currency_nonneg_chk";`);
    this.addSql(`alter table "journal_entry_lines" drop constraint "journal_entry_lines_rate_positive_chk";`);
    this.addSql(`alter table "journal_entry_lines" drop column "exchange_rate";`);
    this.addSql(`alter table "journal_entry_lines" drop column "currency_id";`);
    this.addSql(`alter table "ledger_accounts" drop column "currency_id";`);
  }

}
