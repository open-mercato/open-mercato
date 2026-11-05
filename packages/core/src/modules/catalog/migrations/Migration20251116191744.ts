import { Migration } from '@mikro-orm/migrations';

export class Migration20251116191744 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if to_regclass('catalog_product_variant_relations') is null then
          return;
        end if;

        if exists (
          select 1
          from pg_constraint
          where conrelid = 'catalog_product_variant_relations'::regclass
            and conname = 'catalog_product_variant_relations_unique'
        ) then
          alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_unique";
        end if;

        if not exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'catalog_product_variant_relations'
            and column_name = 'child_product_id'
        ) then
          alter table "catalog_product_variant_relations" add column "child_product_id" uuid null;
        end if;

        if exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'catalog_product_variant_relations'
            and column_name = 'child_variant_id'
        ) then
          alter table "catalog_product_variant_relations" alter column "child_variant_id" drop default;
          alter table "catalog_product_variant_relations" alter column "child_variant_id" type uuid using ("child_variant_id"::text::uuid);
          alter table "catalog_product_variant_relations" alter column "child_variant_id" drop not null;
        end if;

        if not exists (
          select 1
          from pg_constraint
          where conrelid = 'catalog_product_variant_relations'::regclass
            and conname = 'catalog_product_variant_relations_child_product_id_foreign'
        ) then
          alter table "catalog_product_variant_relations"
            add constraint "catalog_product_variant_relations_child_product_id_foreign"
            foreign key ("child_product_id") references "catalog_products" ("id") on update cascade on delete cascade;
        end if;

        if not exists (
          select 1
          from pg_class
          where relname = 'catalog_product_variant_relations_child_product_idx'
            and relkind = 'i'
        ) then
          create index "catalog_product_variant_relations_child_product_idx"
            on "catalog_product_variant_relations" ("child_product_id", "organization_id", "tenant_id");
        end if;
      end
      $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if to_regclass('catalog_product_variant_relations') is null then
          return;
        end if;

        if exists (
          select 1
          from pg_constraint
          where conrelid = 'catalog_product_variant_relations'::regclass
            and conname = 'catalog_product_variant_relations_child_product_id_foreign'
        ) then
          alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_child_product_id_foreign";
        end if;

        drop index if exists "catalog_product_variant_relations_child_product_idx";

        if exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'catalog_product_variant_relations'
            and column_name = 'child_product_id'
        ) then
          alter table "catalog_product_variant_relations" drop column "child_product_id";
        end if;

        if exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'catalog_product_variant_relations'
            and column_name = 'child_variant_id'
        ) then
          alter table "catalog_product_variant_relations" alter column "child_variant_id" drop default;
          alter table "catalog_product_variant_relations" alter column "child_variant_id" type uuid using ("child_variant_id"::text::uuid);
          alter table "catalog_product_variant_relations" alter column "child_variant_id" set not null;
        end if;

        if not exists (
          select 1
          from pg_constraint
          where conrelid = 'catalog_product_variant_relations'::regclass
            and conname = 'catalog_product_variant_relations_unique'
        ) then
          alter table "catalog_product_variant_relations"
            add constraint "catalog_product_variant_relations_unique"
            unique ("parent_variant_id", "child_variant_id", "relation_type");
        end if;
      end
      $$;
    `);
  }

}
