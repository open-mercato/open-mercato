import { Migration } from '@mikro-orm/migrations'

export class Migration20260201000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "attachment_partitions" add column "ocr_model" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "attachment_partitions" drop column "ocr_model";`)
  }
}
