import { Migration } from "@mikro-orm/migrations";

export class Migration20260219084501 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "sales_quote_lines" set "quantity_unit" = 'pc' where lower(btrim(coalesce("quantity_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_quote_lines" set "normalized_unit" = 'pc' where lower(btrim(coalesce("normalized_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_quote_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{enteredUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'enteredUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_quote_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{baseUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'baseUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_quote_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{unitPriceReference,referenceUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"#>>'{unitPriceReference,referenceUnitCode}', '')) = 'qty';`,
    );

    this.addSql(
      `update "sales_order_lines" set "quantity_unit" = 'pc' where lower(btrim(coalesce("quantity_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_order_lines" set "normalized_unit" = 'pc' where lower(btrim(coalesce("normalized_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_order_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{enteredUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'enteredUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_order_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{baseUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'baseUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_order_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{unitPriceReference,referenceUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"#>>'{unitPriceReference,referenceUnitCode}', '')) = 'qty';`,
    );

    this.addSql(
      `update "sales_invoice_lines" set "quantity_unit" = 'pc' where lower(btrim(coalesce("quantity_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_invoice_lines" set "normalized_unit" = 'pc' where lower(btrim(coalesce("normalized_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_invoice_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{enteredUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'enteredUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_invoice_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{baseUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'baseUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_invoice_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{unitPriceReference,referenceUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"#>>'{unitPriceReference,referenceUnitCode}', '')) = 'qty';`,
    );

    this.addSql(
      `update "sales_credit_memo_lines" set "quantity_unit" = 'pc' where lower(btrim(coalesce("quantity_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_credit_memo_lines" set "normalized_unit" = 'pc' where lower(btrim(coalesce("normalized_unit", ''))) = 'qty';`,
    );
    this.addSql(
      `update "sales_credit_memo_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{enteredUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'enteredUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_credit_memo_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{baseUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"->>'baseUnitCode', '')) = 'qty';`,
    );
    this.addSql(
      `update "sales_credit_memo_lines" set "uom_snapshot" = jsonb_set("uom_snapshot", '{unitPriceReference,referenceUnitCode}', '"pc"'::jsonb, true) where "uom_snapshot" is not null and lower(coalesce("uom_snapshot"#>>'{unitPriceReference,referenceUnitCode}', '')) = 'qty';`,
    );
  }

  override async down(): Promise<void> {}
}
