import { Migration } from '@mikro-orm/migrations';

export class Migration20261102090000_assisted_selling extends Migration {

  override name = 'Migration20261102090000';

  override up(): void | Promise<void> {
    this.addSql(`create unique index "assisted_selling_attributions_degraded_unique_idx" on "assisted_selling_attributions" ("tenant_id", "organization_id", "cart_id", coalesce("sales_order_id", "sales_quote_id"), "actor_type", "actor_id") nulls not distinct where "cart_line_id" is null;`);
  }

}
