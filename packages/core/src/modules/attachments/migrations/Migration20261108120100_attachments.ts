import { Migration } from '@mikro-orm/migrations'

// `releaseOwnedScoped` finds the rows that carry an owner as an assignment with a jsonb
// containment probe (`storage_metadata @> '{"assignments":[{"type":…,"id":…}]}'`). Without an
// index that probe scans every row of the tenant. `jsonb_path_ops` supports exactly `@>` and is
// the smaller opclass.
//
// Built CONCURRENTLY because attachments takes a write on every upload. CREATE INDEX
// CONCURRENTLY cannot run inside a transaction, hence isTransactional() => false. Drop first so
// retrying a failed concurrent build removes PostgreSQL's INVALID index stub instead of an
// `if not exists` accepting it. Same shape as Migration20261009120000_attachments.
export class Migration20261108120100_attachments extends Migration {
  override isTransactional(): boolean {
    return false
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "attachments_storage_metadata_gin_idx";`)
    this.addSql(
      `create index concurrently "attachments_storage_metadata_gin_idx" on "attachments" using gin ("storage_metadata" jsonb_path_ops);`,
    )
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "attachments_storage_metadata_gin_idx";`)
  }
}
