import { Migration } from '@mikro-orm/migrations';

// An order recurrence row is retired (deleted_at), not removed, when its order is deleted, so
// the schedule version keeps increasing across delete, undo and redo. The row therefore has to
// outlive a hard-deleted order, and order_id carries no foreign key. Early builds of
// Migration20261026120000 created one with ON DELETE CASCADE; drop it where it exists. On every
// other database this is a no-op.
export class Migration20261107120000_sales_order_recurrences_drop_order_fk extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "sales_order_recurrences" drop constraint if exists "sales_order_recurrences_order_id_foreign";`);
  }

  override async down(): Promise<void> {}

}
