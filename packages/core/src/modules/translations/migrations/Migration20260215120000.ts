import { Migration } from '@mikro-orm/migrations';

export class Migration20260215120000 extends Migration {

  override async up(): Promise<void> {
    // Create entity_translations table
    this.addSql(`create table "entity_translations" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "translations" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), constraint "entity_translations_pkey" primary key ("id"));`);
    this.addSql(`create index "entity_translations_type_idx" on "entity_translations" ("entity_type");`);
    this.addSql(`create index "entity_translations_entity_idx" on "entity_translations" ("entity_id");`);
    this.addSql(`create index "entity_translations_type_tenant_idx" on "entity_translations" ("entity_type", "tenant_id");`);

    // Unique index using COALESCE for nullable org/tenant — prevents duplicate rows per entity scope
    this.addSql(`create unique index "entity_translations_scope_uq" on "entity_translations" ("entity_type", "entity_id", coalesce("organization_id", '00000000-0000-0000-0000-000000000000'), coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'));`);

    // Migrate existing localized_content from catalog_product_offers into entity_translations
    // Guard legacy/fresh schemas where localized_content may already be removed.
    this.addSql(`
      do $$
      begin
        if exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'catalog_product_offers'
            and column_name = 'localized_content'
        ) then
          insert into "entity_translations" ("entity_type", "entity_id", "organization_id", "tenant_id", "translations", "created_at", "updated_at")
          select
            'catalog:catalog_offer',
            o."id"::text,
            o."organization_id",
            o."tenant_id",
            o."localized_content",
            now(),
            now()
          from "catalog_product_offers" o
          where o."localized_content" is not null
            and o."localized_content" != '{}'::jsonb
            and o."deleted_at" is null;
        end if;
      end $$;
    `);

    // Drop localized_content column from catalog_product_offers
    this.addSql(`alter table "catalog_product_offers" drop column if exists "localized_content";`);
  }

  override async down(): Promise<void> {
    // Re-add localized_content column
    this.addSql(`alter table "catalog_product_offers" add column "localized_content" jsonb null;`);

    // Migrate data back
    this.addSql(`
      update "catalog_product_offers" o
      set "localized_content" = et."translations"
      from "entity_translations" et
      where et."entity_type" = 'catalog:catalog_offer'
        and et."entity_id" = o."id"::text
        and (et."organization_id" is not distinct from o."organization_id")
        and (et."tenant_id" is not distinct from o."tenant_id")
    `);

    // Drop entity_translations table
    this.addSql(`drop table if exists "entity_translations" cascade;`);
  }

}
