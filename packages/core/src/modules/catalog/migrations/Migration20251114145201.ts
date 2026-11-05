import { Migration } from '@mikro-orm/migrations';

export class Migration20251114145201 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_product_relations" ("id" uuid not null default gen_random_uuid(), "parent_product_id" uuid not null, "child_product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" boolean not null default false, "min_quantity" int null, "max_quantity" int null, "position" int not null default 0, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_relations_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_relations_child_idx" on "catalog_product_relations" ("child_product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_relations_parent_idx" on "catalog_product_relations" ("parent_product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_unique" unique ("parent_product_id", "child_product_id", "relation_type");`);

    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_parent_product_id_foreign" foreign key ("parent_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_child_product_id_foreign" foreign key ("child_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_offers" drop constraint "catalog_product_offers_product_id_foreign";`);

    this.addSql(`alter table "catalog_products" add column "product_type" text not null default 'simple';`);

    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_offers" drop constraint "catalog_product_offers_product_id_foreign";`);

    this.addSql(`alter table "catalog_products" drop column "product_type";`);

    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade;`);
  }

}
