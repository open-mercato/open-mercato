import { Migration } from '@mikro-orm/migrations';

export class Migration20260218180716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "attachments" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "partition_code" text not null, "file_name" text not null, "mime_type" text not null, "file_size" int not null, "storage_driver" text not null default 'local', "storage_path" text not null, "storage_metadata" jsonb null, "url" text not null, "content" text null, "created_at" timestamptz not null, constraint "attachments_pkey" primary key ("id"));`);
    this.addSql(`create index "attachments_entity_record_idx" on "attachments" ("record_id");`);
    this.addSql(`create index "attachments_partition_code_idx" on "attachments" ("partition_code");`);

    this.addSql(`create table "attachment_partitions" ("id" uuid not null default gen_random_uuid(), "code" text not null, "title" text not null, "description" text null, "storage_driver" text not null default 'local', "config_json" jsonb null, "is_public" boolean not null default false, "requires_ocr" boolean not null default true, "ocr_model" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "attachment_partitions_pkey" primary key ("id"));`);
    this.addSql(`alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");`);
  }

}
