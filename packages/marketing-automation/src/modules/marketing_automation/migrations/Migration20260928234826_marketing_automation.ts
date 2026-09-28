import { Migration } from '@mikro-orm/migrations';

export class Migration20260928234826_marketing_automation extends Migration {

  override name = 'Migration20260928234826';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_product_watches" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "sku" text not null, "currency_code" text not null, "watched_price_gross" text null, "notified_at" timestamptz null, "notified_count" int not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_product_watches_sku_idx" on "marketing_product_watches" ("tenant_id", "organization_id", "sku");`);
    this.addSql(`create unique index "marketing_product_watch_uniq" on "marketing_product_watches" ("tenant_id", "organization_id", "subject_entity_id", "sku") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_product_watches" cascade;`);
  }

}
