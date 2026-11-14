import { Migration } from '@mikro-orm/migrations';

export class Migration20261102090000_assisted_selling extends Migration {

  override name = 'Migration20261102090000';

  override up(): void | Promise<void> {
    this.addSql(`delete from "assisted_selling_attributions" as duplicate using "assisted_selling_attributions" as keeper where duplicate."cart_line_id" is null and keeper."cart_line_id" is null and duplicate."tenant_id" = keeper."tenant_id" and duplicate."organization_id" = keeper."organization_id" and duplicate."cart_id" = keeper."cart_id" and coalesce(duplicate."sales_order_id", duplicate."sales_quote_id") is not distinct from coalesce(keeper."sales_order_id", keeper."sales_quote_id") and duplicate."actor_type" = keeper."actor_type" and duplicate."actor_id" is not distinct from keeper."actor_id" and (duplicate."created_at", duplicate."id") > (keeper."created_at", keeper."id");`);
    this.addSql(`create unique index "assisted_selling_attributions_degraded_unique_idx" on "assisted_selling_attributions" ("tenant_id", "organization_id", "cart_id", coalesce("sales_order_id", "sales_quote_id"), "actor_type", "actor_id") nulls not distinct where "cart_line_id" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "assisted_selling_attributions_degraded_unique_idx";`);
  }

}
