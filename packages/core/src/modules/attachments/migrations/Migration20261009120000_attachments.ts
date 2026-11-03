import { Migration } from '@mikro-orm/migrations'

// Deleting an attachment row locks every row that references the same stored object
// (partition_code + storage_path) to decide whether the object can be removed — catalog
// variant media copies and forwarded message attachments reuse the source row's object.
// Only partition_code was indexed, so that lookup scanned the whole partition: about
// 130 ms per delete with 400k rows in one partition, 0.2 ms with this index.
//
// Built CONCURRENTLY because attachments takes a write on every upload. CREATE INDEX
// CONCURRENTLY cannot run inside a transaction, hence isTransactional() => false. Drop
// first so retrying a failed concurrent build removes PostgreSQL's INVALID index stub.
export class Migration20261009120000_attachments extends Migration {
  override isTransactional(): boolean {
    return false
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "attachments_storage_reference_idx";`)
    this.addSql(
      `create index concurrently "attachments_storage_reference_idx" on "attachments" ("partition_code", "storage_path");`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "attachments_storage_reference_idx";`)
  }
}
