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
export class Migration20260910120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create index if not exists "cf_values_entity_record_key_idx" on "custom_field_values" ("entity_id", "record_id", "field_key");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "cf_values_entity_record_key_idx";`);
  }

}
