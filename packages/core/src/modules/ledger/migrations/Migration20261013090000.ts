import { Migration } from '@mikro-orm/migrations'

// PR #5663 / #6340 review (2026-10-12):
//  - the `parent_account_type_id` and `parent_account_id` columns are dropped:
//    no story or scenario reads them, and the default chart of accounts sets
//    them to null. The parent column returns with the balances rollup that
//    reads it.
//  - the business key `slug` is renamed `number` (same `text not null`
//    column, same data), together with its partial unique indexes. The PL
//    prefix rules live in the commands, not in a constraint, because they
//    depend on rows in other tables; existing rows are not rewritten.
export class Migration20261013090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "ledger_account_types" drop column "parent_account_type_id";`);
    this.addSql(`alter table "ledger_accounts" drop column "parent_account_id";`);

    this.addSql(`alter table "ledger_account_types" rename column "slug" to "number";`);
    this.addSql(`alter table "ledger_accounts" rename column "slug" to "number";`);
    this.addSql(`alter index "ledger_account_types_scope_slug_unique" rename to "ledger_account_types_scope_number_unique";`);
    this.addSql(`alter index "ledger_accounts_scope_slug_unique" rename to "ledger_accounts_scope_number_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter index "ledger_accounts_scope_number_unique" rename to "ledger_accounts_scope_slug_unique";`);
    this.addSql(`alter index "ledger_account_types_scope_number_unique" rename to "ledger_account_types_scope_slug_unique";`);
    this.addSql(`alter table "ledger_accounts" rename column "number" to "slug";`);
    this.addSql(`alter table "ledger_account_types" rename column "number" to "slug";`);

    this.addSql(`alter table "ledger_accounts" add column "parent_account_id" uuid null;`);
    this.addSql(`alter table "ledger_account_types" add column "parent_account_type_id" uuid null;`);
  }

}
