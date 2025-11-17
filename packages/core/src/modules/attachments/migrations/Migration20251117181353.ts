import { Migration } from '@mikro-orm/migrations'

export class Migration20251117181353 extends Migration {
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
    this.addSql(
      `alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");`,
    )

    this.addSql(`
      alter table "attachments"
        add column "partition_code" text null,
        add column "storage_driver" text not null default 'local',
        add column "storage_path" text null,
        add column "storage_metadata" jsonb null;
    `)
    this.addSql(`create index "attachments_partition_code_idx" on "attachments" ("partition_code");`)

    this.addSql(`
      update "attachments"
      set
        "partition_code" = case
          when "entity_id" in ('catalog:catalog_product') then 'productsMedia'
          else 'privateAttachments'
        end,
        "storage_driver" = 'legacyPublic',
        "storage_path" = case
          when coalesce("url", '') <> '' then 'public' || "url"
          else 'public/uploads/attachments'
        end,
        "url" = case
          when coalesce(cast("id" as text), '') <> '' then '/api/attachments/file/' || cast("id" as text)
          else coalesce("url", '')
        end
      where "partition_code" is null or "storage_path" is null;
    `)

    this.addSql(`alter table "attachments" alter column "partition_code" set not null;`)
    this.addSql(`alter table "attachments" alter column "storage_path" set not null;`)

    this.addSql(`
      update "catalog_products"
        set "default_media_url" = '/api/attachments/image/' || cast("default_media_id" as text)
        where coalesce(cast("default_media_id" as text), '') <> '';
    `)
    this.addSql(`
      update "catalog_product_variants"
        set "default_media_url" = '/api/attachments/image/' || cast("default_media_id" as text)
        where coalesce(cast("default_media_id" as text), '') <> '';
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "attachments_partition_code_idx";`)
    this.addSql(
      `alter table "attachments" drop column "partition_code", drop column "storage_driver", drop column "storage_path", drop column "storage_metadata";`,
    )
    this.addSql(`drop table if exists "attachment_partitions" cascade;`)
  }
}
