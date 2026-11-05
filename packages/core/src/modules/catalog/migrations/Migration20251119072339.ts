import { Migration } from '@mikro-orm/migrations';

export class Migration20251119072339 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "catalog_product_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "label" text not null, "slug" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_tags_scope_idx" on "catalog_product_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tags" add constraint "catalog_product_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_tag_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "tag_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "catalog_product_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_tag_assignments_scope_idx" on "catalog_product_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_unique" unique ("product_id", "tag_id");`);

    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "catalog_product_tags" ("id") on update cascade on delete cascade;`);

    this.addSql(`
      update "catalog_products"
        set "default_media_url" = '/api/attachments/image/' || cast("default_media_id" as text)
        where coalesce(cast("default_media_id" as text), '') <> '';
    `);
    this.addSql(`
      update "catalog_product_variants"
        set "default_media_url" = '/api/attachments/image/' || cast("default_media_id" as text)
        where coalesce(cast("default_media_id" as text), '') <> '';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint "catalog_product_tag_assignments_tag_id_foreign";`);
  }

}
