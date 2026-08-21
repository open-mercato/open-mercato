import { Migration } from '@mikro-orm/migrations';

/**
 * Backfill sales line rows that violate the `gross > 0 ⇒ net > 0` invariant
 * (issue #3521, root cause of #3036).
 *
 * `total_net_amount = 0` while `total_gross_amount > 0` is not a representable
 * priced state (`gross = net * (1 + taxRate)`, so `net = 0 ⇒ gross = 0`). Such
 * rows froze the order net grand total on a subsequent return and skewed any
 * invoice / credit-memo line that copied the order line's net. The persistence
 * paths are sealed at the source in `commands/documents.ts` via
 * `reconcileLinePersistedTotals` / `deriveLineNetFromGross`; this migration
 * repairs rows that were already stored in the inconsistent state (including the
 * seeded demo order `SO-DEMO-2001` on tenants provisioned before the fix).
 *
 * The repaired net is reconstructed from the stored gross and tax rate exactly
 * as the runtime helper does: `net = gross / (1 + taxRate/100)`, rounded to the
 * column scale (4). When the tax rate is zero/null the net equals the gross.
 *
 * Forward-only: the original (corrupt) zero net carried no information to
 * restore, so reverting is a no-op.
 */
export class Migration20260624120000_backfill_line_net_from_gross extends Migration {
  override up(): void | Promise<void> {
    for (const table of [
      'sales_order_lines',
      'sales_quote_lines',
      'sales_invoice_lines',
      'sales_credit_memo_lines',
    ]) {
      this.addSql(`
        update "${table}"
        set "total_net_amount" = round(
          "total_gross_amount" / (1 + coalesce("tax_rate", 0) / 100),
          4
        )
        where "total_gross_amount" > 0
          and ("total_net_amount" is null or "total_net_amount" <= 0);
      `);
    }
  }

  override down(): void | Promise<void> {
    // Forward-only data repair. The pre-migration zero/missing net carried no
    // information to restore, and reintroducing the `net = 0, gross > 0` skew
    // would re-open #3036. No-op.
  }
}
