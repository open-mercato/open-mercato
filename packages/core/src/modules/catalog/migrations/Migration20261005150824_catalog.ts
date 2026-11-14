import { Migration } from '@mikro-orm/migrations';

export class Migration20261005150824_catalog extends Migration {

  override name = 'Migration20261005150824';

  override up(): void | Promise<void> {
    this.addSql(`create table "catalog_price_history_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "price_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "offer_id" uuid null, "channel_id" uuid null, "price_kind_id" uuid not null, "price_kind_code" text not null, "currency_code" varchar(3) not null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "tax_rate" numeric(7,4) null, "tax_amount" numeric(16,4) null, "min_quantity" int null, "max_quantity" int null, "starts_at" timestamptz null, "ends_at" timestamptz null, "recorded_at" timestamptz not null, "change_type" text not null, "source" text not null, "is_announced" boolean null, "idempotency_key" text null, "metadata" jsonb null, primary key ("id"));`);
    this.addSql(`create index "catalog_price_history_price_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "price_id");`);
    this.addSql(`create index "catalog_price_history_offer_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "offer_id", "price_kind_id", "currency_code", "recorded_at" desc);`);
    this.addSql(`create index "catalog_price_history_variant_channel_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "variant_id", "channel_id", "price_kind_id", "currency_code", "recorded_at" desc);`);
    this.addSql(`create index "catalog_price_history_variant_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "variant_id", "price_kind_id", "currency_code", "recorded_at" desc);`);
    this.addSql(`create index "catalog_price_history_product_channel_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "product_id", "channel_id", "price_kind_id", "currency_code", "recorded_at" desc);`);
    this.addSql(`create index "catalog_price_history_product_idx" on "catalog_price_history_entries" ("tenant_id", "organization_id", "product_id", "price_kind_id", "currency_code", "recorded_at" desc);`);

    this.addSql(`alter table "catalog_price_history_entries" add constraint "catalog_price_history_entries_change_type_check" check ("change_type" in ('create', 'update', 'delete', 'undo'));`);
    this.addSql(`alter table "catalog_price_history_entries" add constraint "catalog_price_history_entries_source_check" check ("source" in ('api', 'system'));`);
    this.addSql(`create unique index "catalog_price_history_idempotency_uq" on "catalog_price_history_entries" ("tenant_id", "organization_id", "idempotency_key") where "idempotency_key" is not null;`);

    this.addSql(`-- MANUAL DDL: immutability trigger and role restriction
CREATE OR REPLACE FUNCTION catalog_price_history_prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'catalog_price_history_entries is immutable';
END;
$$ LANGUAGE plpgsql;`);
    this.addSql(`-- DEPLOY RUNBOOK (production): grant the app role INSERT/SELECT only.
-- REVOKE UPDATE, DELETE ON catalog_price_history_entries FROM <app_db_role>;
CREATE OR REPLACE TRIGGER history_immutable
  BEFORE UPDATE OR DELETE ON catalog_price_history_entries
  FOR EACH ROW EXECUTE FUNCTION catalog_price_history_prevent_modification();`);
  }

  override down(): void | Promise<void> {
    this.addSql(`DROP TRIGGER IF EXISTS history_immutable ON catalog_price_history_entries;`);
    this.addSql(`DROP FUNCTION IF EXISTS catalog_price_history_prevent_modification();`);
    this.addSql(`drop table if exists "catalog_price_history_entries" cascade;`);
  }

}
