import { Migration } from '@mikro-orm/migrations'

/**
 * Omnibus (EU 98/6/EC Art. 6a) snapshot columns on sales lines.
 *
 * The six columns are captured once, when a line is created, and are never
 * recomputed on later edits: an order or quote is the legal record of what the
 * buyer was shown at purchase time, so the reference price, the promotion
 * anchor and the personalization disclosure must be frozen with the line.
 * All columns are nullable — a tenant with omnibus disabled, a line without a
 * catalog product, or an absent catalog module all leave them empty.
 *
 * The numeric precision is 18,4 to match the sales line amount columns
 * (intentionally wider than the catalog history table's 16,4).
 */
export class Migration20260721120200_sales extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table "sales_order_lines"
        add column if not exists "omnibus_reference_net" numeric(18, 4) null,
        add column if not exists "omnibus_reference_gross" numeric(18, 4) null,
        add column if not exists "omnibus_promotion_anchor_at" timestamptz null,
        add column if not exists "omnibus_applicability_reason" text null,
        add column if not exists "is_personalized" boolean null,
        add column if not exists "personalization_reason" text null;
    `)

    this.addSql(`
      alter table "sales_quote_lines"
        add column if not exists "omnibus_reference_net" numeric(18, 4) null,
        add column if not exists "omnibus_reference_gross" numeric(18, 4) null,
        add column if not exists "omnibus_promotion_anchor_at" timestamptz null,
        add column if not exists "omnibus_applicability_reason" text null,
        add column if not exists "is_personalized" boolean null,
        add column if not exists "personalization_reason" text null;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "sales_order_lines"
        drop column if exists "omnibus_reference_net",
        drop column if exists "omnibus_reference_gross",
        drop column if exists "omnibus_promotion_anchor_at",
        drop column if exists "omnibus_applicability_reason",
        drop column if exists "is_personalized",
        drop column if exists "personalization_reason";
    `)

    this.addSql(`
      alter table "sales_quote_lines"
        drop column if exists "omnibus_reference_net",
        drop column if exists "omnibus_reference_gross",
        drop column if exists "omnibus_promotion_anchor_at",
        drop column if exists "omnibus_applicability_reason",
        drop column if exists "is_personalized",
        drop column if exists "personalization_reason";
    `)
  }

}
