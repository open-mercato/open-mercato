import { Migration } from '@mikro-orm/migrations';

export class Migration20261029114801_catalog extends Migration {

  override name = 'Migration20261029114801';

  override up(): void | Promise<void> {
    this.addSql(`create table "catalog_product_category_suggestions" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "outcome" text not null, "category_id" uuid null, "category_path_ids" jsonb not null default '[]', "confidence" numeric(5,4) null, "levels" jsonb not null default '[]', "status" text not null, "trigger" text not null, "provider" text null, "model" text null, "prompt_version" text null, "cost_usd" numeric(10,6) null, "duration_ms" int null, "requested_by_user_id" uuid null, "reviewed_by_user_id" uuid null, "reviewed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "catalog_product_category_suggestions_product_created_idx" on "catalog_product_category_suggestions" ("product_id", "created_at");`);
    this.addSql(`create index "catalog_product_category_suggestions_scope_idx" on "catalog_product_category_suggestions" ("organization_id", "tenant_id");`);
    // Partial unique index — at most one pending suggestion per product. Not
    // expressible via MikroORM decorators (no WHERE support), so it is
    // hand-written here, same pattern as module_configs' scoped uniques.
    this.addSql(`create unique index "catalog_product_category_suggestions_pending_unique" on "catalog_product_category_suggestions" ("product_id") where "status" = 'pending';`);

    this.addSql(`alter table "catalog_product_category_suggestions" add constraint "catalog_product_category_suggestions_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "catalog_product_category_suggestions" cascade;`);
  }

}
