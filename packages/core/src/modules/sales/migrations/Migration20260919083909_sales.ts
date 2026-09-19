import { Migration } from '@mikro-orm/migrations';

// Per organization tax provider selection for spec
// .ai/specs/2026-09-19-pluggable-tax-providers.md.
//
// All four columns are nullable with no default and no backfill. A NULL
// tax_provider_key means the built in table-rates provider, which is the
// behaviour every organization already has, so this migration changes nothing
// for anyone until a merchant opens the settings page. Rolling back a selection
// is setting the column back to NULL; the columns themselves can stay.
//
// ship_from_address is declared in the module's encryption map, so it is
// encrypted at rest like every other address this module stores.
export class Migration20260919083909_sales extends Migration {

  override name = 'Migration20260919083909';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_settings" add "tax_provider_key" text null, add "tax_provider_settings" jsonb null, add "tax_provider_timeout_ms" int null, add "ship_from_address" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_settings" drop column "tax_provider_key", drop column "tax_provider_settings", drop column "tax_provider_timeout_ms", drop column "ship_from_address";`);
  }

}
