import { Migration } from '@mikro-orm/migrations'

/**
 * Lets the price-watch scan rotate instead of re-reading the same rows for ever.
 *
 * The scan takes a bounded number of watches per tick and ordered them by creation, so on an installation
 * with more watches than the cap everything past it was never looked at once — and nothing anywhere said so.
 * Ordering by "least recently scanned" turns the cap into a queue.
 *
 * Nullable with no backfill, and the ordering puts nulls first on purpose: every existing watch counts as
 * never scanned, so the rows that have been starved are the ones served first.
 */
export class Migration20261002101500_marketing_watch_rotation extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "marketing_product_watches" add column "last_scanned_at" timestamptz null;')
    this.addSql(
      'create index "mkt_watch_rotation_idx" on "marketing_product_watches" '
      + '("tenant_id", "organization_id", "last_scanned_at");',
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop index "mkt_watch_rotation_idx";')
    this.addSql('alter table "marketing_product_watches" drop column "last_scanned_at";')
  }
}
