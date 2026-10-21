import { Migration } from '@mikro-orm/migrations';

export class Migration20261019200324_sales extends Migration {

  override name = 'Migration20261019200324';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_quotes" add "deal_id" uuid null;`);
    this.addSql(`create index "sales_quotes_deal_idx" on "sales_quotes" ("deal_id", "organization_id", "tenant_id");`);

    this.addSql(`alter table "sales_orders" add "deal_id" uuid null;`);
    this.addSql(`create index "sales_orders_deal_idx" on "sales_orders" ("deal_id", "organization_id", "tenant_id");`);

    this.addSql(`alter table "sales_invoices" add "deal_id" uuid null;`);
    this.addSql(`create index "sales_invoices_deal_idx" on "sales_invoices" ("deal_id", "organization_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "sales_invoices_deal_idx";`);
    this.addSql(`alter table "sales_invoices" drop column "deal_id";`);

    this.addSql(`drop index "sales_orders_deal_idx";`);
    this.addSql(`alter table "sales_orders" drop column "deal_id";`);

    this.addSql(`drop index "sales_quotes_deal_idx";`);
    this.addSql(`alter table "sales_quotes" drop column "deal_id";`);
  }

}
