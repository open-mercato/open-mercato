import { Migration } from '@mikro-orm/migrations';

export class Migration20261027180000_assisted_selling extends Migration {

  override name = 'Migration20261027180000';

  override up(): void | Promise<void> {
    this.addSql(`create table "assisted_selling_attributions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sales_order_id" uuid null, "sales_order_line_id" uuid null, "sales_quote_id" uuid null, "sales_quote_line_id" uuid null, "cart_id" uuid not null, "cart_line_id" uuid null, "actor_type" text not null, "actor_id" uuid null, "thread_id" uuid null, "proposal_id" uuid null, "line_net_amount" numeric(16,4) not null, "line_gross_amount" numeric(16,4) not null, "currency_code" text not null, "converted_at" timestamptz not null, "created_at" timestamptz not null, constraint "assisted_selling_attributions_order_xor_quote_chk" check (("sales_order_id" is not null and "sales_quote_id" is null) or ("sales_order_id" is null and "sales_quote_id" is not null)), primary key ("id"));`);
    this.addSql(`create index "assisted_selling_attributions_tenant_org_idx" on "assisted_selling_attributions" ("tenant_id", "organization_id");`);
    this.addSql(`create index "assisted_selling_attributions_tenant_cart_idx" on "assisted_selling_attributions" ("tenant_id", "cart_id");`);
    this.addSql(`create index "assisted_selling_attributions_tenant_actor_converted_idx" on "assisted_selling_attributions" ("tenant_id", "actor_type", "actor_id", "converted_at");`);
    this.addSql(`create unique index "assisted_selling_attributions_order_line_unique_idx" on "assisted_selling_attributions" ("tenant_id", "sales_order_line_id", "proposal_id") nulls not distinct where "sales_order_line_id" is not null;`);
    this.addSql(`create unique index "assisted_selling_attributions_quote_line_unique_idx" on "assisted_selling_attributions" ("tenant_id", "sales_quote_line_id", "proposal_id") nulls not distinct where "sales_quote_line_id" is not null;`);
  }

}
