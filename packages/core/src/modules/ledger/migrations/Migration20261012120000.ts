import { Migration } from '@mikro-orm/migrations'

// art. 14 ust. 4 Ustawy o rachunkowości: books kept by computer must carry
// data identifying the person responsible for an entry's content. Adds the
// nullable `posted_by` column (the authenticated subject that posted the
// entry). A plain ADD COLUMN: the append-only trigger on `journal_entries`
// blocks UPDATE and DELETE, not DDL, and existing rows keep NULL.
export class Migration20261012120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "journal_entries" add column "posted_by" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "journal_entries" drop column "posted_by";`);
  }

}
