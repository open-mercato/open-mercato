import { Migration } from '@mikro-orm/migrations'

// Owner entity ids kept out of the shared attachments library (`listInLibrary: false` on a
// protected target). Filled by partition creation and the access-protection sync as a union;
// an older build ignores the column.
export class Migration20261108120000_attachments extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "attachment_partitions" add column if not exists "library_excluded_entities" jsonb null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "attachment_partitions" drop column if exists "library_excluded_entities";`)
  }
}
