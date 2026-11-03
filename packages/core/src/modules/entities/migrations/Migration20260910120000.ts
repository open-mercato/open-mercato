import { Migration } from '@mikro-orm/migrations';

// Index the logical key of a custom field value: (entity_id, record_id, field_key).
// `setRecordCustomFields` now reconciles every row for that key on write so a record whose
// organization/tenant scope changed cannot keep the previous scope's row alive (#5970), and this
// index is what makes that lookup — and the reader join, which matches the same three columns
// without pinning organization_id — an index scan instead of a sequential one. The existing
// `cf_values_entity_record_tenant_idx` cannot serve it: field_key is not in that index and its
// third column is tenant_id, which the logical-key lookup deliberately does not filter on.
//
// Non-unique on purpose. A multi-value custom field legitimately stores one row per selected
// value, all sharing (entity_id, record_id, field_key, organization_id, tenant_id) and differing
// only in the value column, so a UNIQUE index on the logical key would reject every multi-select
// write. The "one live row per single-value field" invariant is therefore enforced in the write
// path rather than by a constraint.
//
// custom_field_values is the EAV values table — one row per custom field per record, and a write
// on every record save — so the index is built CONCURRENTLY. A plain CREATE INDEX takes a SHARE
// lock that blocks every INSERT/UPDATE/DELETE on the table, and inside a transactional migration
// that lock is held until the whole migration commits, not just for the build. CREATE INDEX
// CONCURRENTLY cannot run inside a transaction, hence isTransactional() => false; the migration
// runner applies migrations one-by-one, so the opt-out is safe. Drop first so retrying a failed
// concurrent build removes PostgreSQL's invalid index stub instead of letting IF NOT EXISTS
// silently accept it: a half-built concurrent index is left INVALID, the planner ignores it, and
// IF NOT EXISTS would report success while the table stays unindexed. Same shape as
// Migration20260821120000_sales_notes_addresses_context_idx.
export class Migration20260910120000 extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override async up(): Promise<void> {
    this.addSql(`drop index concurrently if exists "cf_values_entity_record_key_idx";`);
    this.addSql(`create index concurrently if not exists "cf_values_entity_record_key_idx" on "custom_field_values" ("entity_id", "record_id", "field_key");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index concurrently if exists "cf_values_entity_record_key_idx";`);
  }

}
