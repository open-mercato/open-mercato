import { Migration } from '@mikro-orm/migrations';

// Release 5, Step 2.13 (checkout C13/D-R5-35). Flat-rate carrier fallback for LINK carts —
// `CheckoutLinkTemplate`/`CheckoutLink` are concrete-table inheritance (each `@Entity`
// maps its own table), so the two new columns land on both tables, mirroring how
// `gateway_provider_key`/`gateway_settings` were added in the original migration.
export class Migration20261027180000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "checkout_link_templates" add column "flat_rate_shipping_amount" numeric(12,2) null, add column "flat_rate_shipping_currency_code" text null;`);
    this.addSql(`alter table "checkout_links" add column "flat_rate_shipping_amount" numeric(12,2) null, add column "flat_rate_shipping_currency_code" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "checkout_link_templates" drop column "flat_rate_shipping_amount", drop column "flat_rate_shipping_currency_code";`);
    this.addSql(`alter table "checkout_links" drop column "flat_rate_shipping_amount", drop column "flat_rate_shipping_currency_code";`);
  }

}
