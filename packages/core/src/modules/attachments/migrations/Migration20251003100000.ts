import { Migration } from '@mikro-orm/migrations'

export class Migration20251003100000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "attachments" (
      "id" uuid primary key default gen_random_uuid(),
      "entity_id" text not null,
      "record_id" text not null,
      "organization_id" uuid null,
      "tenant_id" uuid null,
      "file_name" text not null,
      "mime_type" text not null,
      "file_size" int not null,
      "url" text not null,
      "created_at" timestamptz not null default CURRENT_TIMESTAMP
    );`)
    this.addSql(`create index if not exists "attachments_entity_record_idx" on "attachments" ("entity_id", "record_id");`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "attachments" cascade;')
  }
}

