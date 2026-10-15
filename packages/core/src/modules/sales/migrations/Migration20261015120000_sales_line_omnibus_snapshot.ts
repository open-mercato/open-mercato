import { Migration } from '@mikro-orm/migrations';

// Omnibus (EU 98/6/EC Art. 6a, Directive 2019/2161) snapshot columns on order and quote lines.
//
// The six columns are captured once, when a line is created, and never recomputed on later
// edits: the line is the record of what the buyer was shown, so the reference price, the
// promotion anchor and the personalization disclosure stay frozen with it. Every column is
// nullable — a tenant with Omnibus disabled, a line without a catalog product, or an install
// without the catalog module all leave them empty — so adding them is metadata-only and
// rewrites no rows.
//
// numeric(18, 4) matches the sales line amount columns, deliberately wider than the catalog
// price history table's numeric(16, 4).
export class Migration20261015120000_sales_line_omnibus_snapshot extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_order_lines" add column if not exists "omnibus_reference_net" numeric(18,4) null, add column if not exists "omnibus_reference_gross" numeric(18,4) null, add column if not exists "omnibus_promotion_anchor_at" timestamptz null, add column if not exists "omnibus_applicability_reason" text null, add column if not exists "is_personalized" boolean null, add column if not exists "personalization_reason" text null;`);
    this.addSql(`alter table "sales_quote_lines" add column if not exists "omnibus_reference_net" numeric(18,4) null, add column if not exists "omnibus_reference_gross" numeric(18,4) null, add column if not exists "omnibus_promotion_anchor_at" timestamptz null, add column if not exists "omnibus_applicability_reason" text null, add column if not exists "is_personalized" boolean null, add column if not exists "personalization_reason" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_quote_lines" drop column if exists "omnibus_reference_net", drop column if exists "omnibus_reference_gross", drop column if exists "omnibus_promotion_anchor_at", drop column if exists "omnibus_applicability_reason", drop column if exists "is_personalized", drop column if exists "personalization_reason";`);
    this.addSql(`alter table "sales_order_lines" drop column if exists "omnibus_reference_net", drop column if exists "omnibus_reference_gross", drop column if exists "omnibus_promotion_anchor_at", drop column if exists "omnibus_applicability_reason", drop column if exists "is_personalized", drop column if exists "personalization_reason";`);
  }

}
