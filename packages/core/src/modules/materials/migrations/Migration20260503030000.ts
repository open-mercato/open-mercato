import { Migration } from '@mikro-orm/migrations'

export class Migration20260503030000 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`create table "material_prices" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "material_supplier_link_id" uuid not null,
      "price_amount" numeric(18,6) not null,
      "currency_id" uuid not null,
      "base_currency_amount" numeric(18,6) null,
      "base_currency_at" timestamptz null,
      "valid_from" timestamptz null,
      "valid_to" timestamptz null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      primary key ("id")
    );`)

    this.addSql(`create index "material_prices_supplier_link_valid_from_idx" on "material_prices" ("material_supplier_link_id", "valid_from");`)
    this.addSql(`create index "material_prices_currency_idx" on "material_prices" ("currency_id");`)
    // Domain constraints — DB last line of defense; command also rejects with translated message.
    this.addSql(`alter table "material_prices" add constraint "material_prices_amount_positive" check ("price_amount" > 0);`)
    this.addSql(`alter table "material_prices" add constraint "material_prices_validity_range" check ("valid_from" is null or "valid_to" is null or "valid_to" >= "valid_from");`)
    this.addSql(`alter table "material_prices" add constraint "material_prices_base_amount_nonneg" check ("base_currency_amount" is null or "base_currency_amount" >= 0);`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "material_prices" cascade;`)
  }
}
