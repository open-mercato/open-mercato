import { Migration } from '@mikro-orm/migrations'

export class Migration20260204120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "attachment_partitions" (
        "id" uuid not null default gen_random_uuid(),
        "code" text not null,
        "title" text not null,
        "description" text null,
        "storage_driver" text not null default 'local',
        "config_json" jsonb null,
        "is_public" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "attachment_partitions_pkey" primary key ("id")
      );
    `)
    this.addSql(`
      create unique index "attachment_partitions_code_unique"
        on "attachment_partitions" ("code");
    `)

    this.addSql(`alter table "attachments" add column "partition_code" text not null default 'privateAttachments';`)
    this.addSql(`create index "attachments_partition_code_idx" on "attachments" ("partition_code");`)
    this.addSql(`alter table "attachments" add column "storage_driver" text not null default 'local';`)
    this.addSql(`alter table "attachments" add column "storage_path" text not null default '';`)
    this.addSql(`alter table "attachments" add column "storage_metadata" jsonb null;`)

    this.addSql(`
      update "attachments"
        set "storage_path" = 'public' || "url",
            "storage_driver" = 'legacyPublic'
        where coalesce("storage_path", '') = '';
    `)
    this.addSql(`
      update "attachments"
        set "partition_code" = 'productsMedia'
        where "entity_id" in ('catalog:catalog_product');
    `)
    this.addSql(`
      update "attachments"
        set "url" = '/api/attachments/file/' || "id"
        where coalesce("url", '') <> '' and "url" not like '/api/attachments/file/%';
    `)
    this.addSql(`
      update "catalog_products"
        set "default_media_url" = '/api/attachments/image/' || "default_media_id"
        where coalesce("default_media_id", '') <> '';
    `)
    this.addSql(`
      update "catalog_product_variants"
        set "default_media_url" = '/api/attachments/image/' || "default_media_id"
        where coalesce("default_media_id", '') <> '';
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "attachments" drop column "storage_metadata";`)
    this.addSql(`alter table "attachments" drop column "storage_path";`)
    this.addSql(`alter table "attachments" drop column "storage_driver";`)
    this.addSql(`drop index "attachments_partition_code_idx";`)
    this.addSql(`alter table "attachments" drop column "partition_code";`)
    this.addSql(`drop table if exists "attachment_partitions" cascade;`)
  }
}
