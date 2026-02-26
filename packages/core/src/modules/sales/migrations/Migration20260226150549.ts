import { Migration } from '@mikro-orm/migrations';

export class Migration20260226150549 extends Migration {

  override async up(): Promise<void> {
    // sales_order_lines columns already added by Migration20260225110000
    this.addSql(`alter table "sales_quote_lines" add column "omnibus_reference_net" text null, add column "omnibus_reference_gross" text null, add column "omnibus_promotion_anchor_at" timestamptz null, add column "omnibus_applicability_reason" text null, add column "is_personalized" boolean null, add column "personalization_reason" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quote_lines" drop column "omnibus_reference_net", drop column "omnibus_reference_gross", drop column "omnibus_promotion_anchor_at", drop column "omnibus_applicability_reason", drop column "is_personalized", drop column "personalization_reason";`);
  }

}
