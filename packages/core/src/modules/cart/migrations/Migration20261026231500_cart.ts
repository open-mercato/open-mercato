import { Migration } from '@mikro-orm/migrations';

export class Migration20261026231500_cart extends Migration {

  override name = 'Migration20261026231500';

  override up(): void | Promise<void> {
    this.addSql(`alter table "carts" add column "grand_total_gross_amount" numeric(16,4) generated always as ((totals->>'grandTotalGrossAmount')::numeric(16,4)) stored null;`);
    this.addSql(`create index "carts_tenant_status_grand_total_idx" on "carts" ("tenant_id", "status", "grand_total_gross_amount");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "carts_tenant_status_grand_total_idx";`);
    this.addSql(`alter table "carts" drop column "grand_total_gross_amount";`);
  }

}
