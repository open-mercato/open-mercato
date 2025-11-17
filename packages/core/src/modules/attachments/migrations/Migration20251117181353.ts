import { Migration } from '@mikro-orm/migrations';

export class Migration20251117181353 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "attachment_partitions" ("id" uuid not null default gen_random_uuid(), "code" text not null, "title" text not null, "description" text null, "storage_driver" text not null default 'local', "config_json" jsonb null, "is_public" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "attachment_partitions_pkey" primary key ("id"));`);
    this.addSql(`alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");`);

    this.addSql(`alter table "attachments" add column "partition_code" text not null, add column "storage_driver" text not null default 'local', add column "storage_path" text not null, add column "storage_metadata" jsonb null;`);
    this.addSql(`create index "attachments_partition_code_idx" on "attachments" ("partition_code");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "attachments_partition_code_idx";`);
    this.addSql(`alter table "attachments" drop column "partition_code", drop column "storage_driver", drop column "storage_path", drop column "storage_metadata";`);
  }

}
