import { Migration } from '@mikro-orm/migrations';

// Puts the shipped-line freeze behind a per-scope setting instead of compiling it
// in. The column defaults to false — the freeze stays enforced — so an upgrade is
// a no-op for every database that already has this table, and only a deployment
// that opts in changes behaviour.
//
// `not null default false` rather than a nullable tri-state: unlike its two
// neighbours in this table, which are status *lists* where NULL legitimately means
// "no policy configured", this is a plain on/off with a defined answer for every
// row. A scope with no sales_settings row at all still resolves to the default in
// application code, so absence and false agree.
export class Migration20260826120000_sales_settings_shipped_line_editable extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_settings" add column "order_shipped_line_editable" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_settings" drop column "order_shipped_line_editable";`);
  }

}
