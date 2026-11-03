import { Migration } from '@mikro-orm/migrations';

// Opt-in `external` amounts mode for sales orders: the row-level statement that
// the stored amounts are a caller's assertion mirrored from an external book of
// record, not something core derived. Two defaulted columns, no backfill — every
// existing row takes 'computed', which is exactly today's behaviour, so the
// change is observably inert until a caller sets the mode.
//
// PostgreSQL has not rewritten a table for a defaulted column add since 11, so
// both statements are metadata-only regardless of table size.
export class Migration20260910120000_sales_external_amounts_mode extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "sales_orders" add column if not exists "totals_mode" text not null default 'computed';`,
    );
    this.addSql(
      `alter table "sales_order_lines" add column if not exists "amounts_mode" text not null default 'computed';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_order_lines" drop column if exists "amounts_mode";`);
    this.addSql(`alter table "sales_orders" drop column if exists "totals_mode";`);
  }
}
