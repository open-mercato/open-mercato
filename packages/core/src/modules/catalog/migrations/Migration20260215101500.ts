import { Migration } from '@mikro-orm/migrations'

export class Migration20260215101500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      update "catalog_product_variants"
      set "option_values" = "metadata" -> 'optionValues',
          "metadata" = nullif(("metadata" - 'optionValues'), '{}'::jsonb)
      where "metadata" ? 'optionValues';
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      update "catalog_product_variants"
      set "metadata" = coalesce("metadata", '{}'::jsonb) || jsonb_build_object('optionValues', "option_values"),
          "option_values" = null
      where "option_values" is not null;
    `)
  }

}
