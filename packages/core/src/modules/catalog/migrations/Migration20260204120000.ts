import { Migration } from '@mikro-orm/migrations'

export class Migration20260204120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_product_variant_relations" ("id" uuid not null default gen_random_uuid(), "parent_variant_id" uuid not null, "child_variant_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" boolean not null default false, "min_quantity" int null, "max_quantity" int null, "position" int not null default 0, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_variant_relations_pkey" primary key ("id"));`)
    this.addSql(`create index "catalog_product_variant_relations_parent_idx" on "catalog_product_variant_relations" ("parent_variant_id", "organization_id", "tenant_id");`)
    this.addSql(`create index "catalog_product_variant_relations_child_idx" on "catalog_product_variant_relations" ("child_variant_id", "organization_id", "tenant_id");`)
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_unique" unique ("parent_variant_id", "child_variant_id", "relation_type");`)
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_parent_variant_id_foreign" foreign key ("parent_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`)
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_child_variant_id_foreign" foreign key ("child_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`)
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_product_variant_relations" cascade;')
  }

}
