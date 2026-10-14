import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082519_checkout extends Migration {

  override name = 'Migration20261014082519';

  override up(): void | Promise<void> {
    this.addSql(`alter table "checkout_links" alter column "custom_amount_max" type numeric using ("custom_amount_max"::numeric);`);
    this.addSql(`alter table "checkout_links" alter column "custom_amount_min" type numeric using ("custom_amount_min"::numeric);`);
    this.addSql(`alter table "checkout_links" alter column "fixed_price_amount" type numeric using ("fixed_price_amount"::numeric);`);
    this.addSql(`alter table "checkout_links" alter column "fixed_price_original_amount" type numeric using ("fixed_price_original_amount"::numeric);`);

    this.addSql(`alter table "checkout_link_templates" alter column "custom_amount_max" type numeric using ("custom_amount_max"::numeric);`);
    this.addSql(`alter table "checkout_link_templates" alter column "custom_amount_min" type numeric using ("custom_amount_min"::numeric);`);
    this.addSql(`alter table "checkout_link_templates" alter column "fixed_price_amount" type numeric using ("fixed_price_amount"::numeric);`);
    this.addSql(`alter table "checkout_link_templates" alter column "fixed_price_original_amount" type numeric using ("fixed_price_original_amount"::numeric);`);

    this.addSql(`alter table "checkout_transactions" alter column "amount" type numeric using ("amount"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "checkout_link_templates" alter column "fixed_price_amount" type numeric(12,2) using ("fixed_price_amount"::numeric(12,2));`);
    this.addSql(`alter table "checkout_link_templates" alter column "fixed_price_original_amount" type numeric(12,2) using ("fixed_price_original_amount"::numeric(12,2));`);
    this.addSql(`alter table "checkout_link_templates" alter column "custom_amount_min" type numeric(12,2) using ("custom_amount_min"::numeric(12,2));`);
    this.addSql(`alter table "checkout_link_templates" alter column "custom_amount_max" type numeric(12,2) using ("custom_amount_max"::numeric(12,2));`);

    this.addSql(`alter table "checkout_links" alter column "fixed_price_amount" type numeric(12,2) using ("fixed_price_amount"::numeric(12,2));`);
    this.addSql(`alter table "checkout_links" alter column "fixed_price_original_amount" type numeric(12,2) using ("fixed_price_original_amount"::numeric(12,2));`);
    this.addSql(`alter table "checkout_links" alter column "custom_amount_min" type numeric(12,2) using ("custom_amount_min"::numeric(12,2));`);
    this.addSql(`alter table "checkout_links" alter column "custom_amount_max" type numeric(12,2) using ("custom_amount_max"::numeric(12,2));`);

    this.addSql(`alter table "checkout_transactions" alter column "amount" type numeric(12,2) using ("amount"::numeric(12,2));`);
  }

}
