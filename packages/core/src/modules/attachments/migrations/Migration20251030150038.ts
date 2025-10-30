import { Migration } from '@mikro-orm/migrations';

export class Migration20251030150038 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "attachments" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "file_name" text not null, "mime_type" text not null, "file_size" int not null, "url" text not null, "created_at" timestamptz not null, constraint "attachments_pkey" primary key ("id"));`);
    this.addSql(`create index "attachments_entity_record_idx" on "attachments" ("record_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "attachments" cascade;`);
  }

}
