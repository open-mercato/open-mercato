import { Migration } from '@mikro-orm/migrations';

export class Migration20251116191744 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_unique";`);

    this.addSql(`alter table "catalog_product_variant_relations" add column "child_product_id" uuid null;`);
    this.addSql(`alter table "catalog_product_variant_relations" alter column "child_variant_id" drop default;`);
    this.addSql(`alter table "catalog_product_variant_relations" alter column "child_variant_id" type uuid using ("child_variant_id"::text::uuid);`);
    this.addSql(`alter table "catalog_product_variant_relations" alter column "child_variant_id" drop not null;`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_child_product_id_foreign" foreign key ("child_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`create index "catalog_product_variant_relations_child_product_idx" on "catalog_product_variant_relations" ("child_product_id", "organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_child_product_id_foreign";`);

    this.addSql(`drop index "catalog_product_variant_relations_child_product_idx";`);
    this.addSql(`alter table "catalog_product_variant_relations" drop column "child_product_id";`);

    this.addSql(`alter table "catalog_product_variant_relations" alter column "child_variant_id" drop default;`);
    this.addSql(`alter table "catalog_product_variant_relations" alter column "child_variant_id" type uuid using ("child_variant_id"::text::uuid);`);
    this.addSql(`alter table "catalog_product_variant_relations" alter column "child_variant_id" set not null;`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_unique" unique ("parent_variant_id", "child_variant_id", "relation_type");`);
  }

}
