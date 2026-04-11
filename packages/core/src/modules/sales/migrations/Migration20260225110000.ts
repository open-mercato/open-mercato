import { Migration } from '@mikro-orm/migrations'

export class Migration20260225110000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_order_lines" add column "omnibus_reference_net" text null;`)
    this.addSql(`alter table "sales_order_lines" add column "omnibus_reference_gross" text null;`)
    this.addSql(`alter table "sales_order_lines" add column "omnibus_promotion_anchor_at" timestamptz null;`)
    this.addSql(`alter table "sales_order_lines" add column "omnibus_applicability_reason" text null;`)
    this.addSql(`alter table "sales_order_lines" add column "is_personalized" boolean null;`)
    this.addSql(`alter table "sales_order_lines" add column "personalization_reason" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_order_lines" drop column "omnibus_reference_net";`)
    this.addSql(`alter table "sales_order_lines" drop column "omnibus_reference_gross";`)
    this.addSql(`alter table "sales_order_lines" drop column "omnibus_promotion_anchor_at";`)
    this.addSql(`alter table "sales_order_lines" drop column "omnibus_applicability_reason";`)
    this.addSql(`alter table "sales_order_lines" drop column "is_personalized";`)
    this.addSql(`alter table "sales_order_lines" drop column "personalization_reason";`)
  }

}
