import { Migration } from '@mikro-orm/migrations'

export class Migration20260201000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "attachment_partitions" add column "requires_ocr" boolean not null default true;`)
    this.addSql(`alter table "attachments" add column "content" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "attachment_partitions" drop column "requires_ocr";`)
    this.addSql(`alter table "attachments" drop column "content";`)
  }
}
