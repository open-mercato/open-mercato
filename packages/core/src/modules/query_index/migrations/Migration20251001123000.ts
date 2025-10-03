import { Migration } from '@mikro-orm/migrations'

export class Migration20251001123000 extends Migration {
  async up(): Promise<void> {
    // Add generated coalesced column for deterministic uniqueness across NULL orgs
    this.addSql(`
      alter table "entity_indexes"
      add column if not exists "organization_id_coalesced" uuid
      generated always as (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;
    `)
    // Drop previous partial unique indexes if they exist
    this.addSql('drop index if exists "entity_indexes_unique_scoped";')
    this.addSql('drop index if exists "entity_indexes_unique_global";')
    // Create a single unique constraint on (entity_type, entity_id, organization_id_coalesced)
    this.addSql('create unique index if not exists "entity_indexes_unique_all" on "entity_indexes" ("entity_type", "entity_id", "organization_id_coalesced");')
  }

  async down(): Promise<void> {
    // Best-effort rollback: drop new unique index and generated column
    this.addSql('drop index if exists "entity_indexes_unique_all";')
    this.addSql('alter table "entity_indexes" drop column if exists "organization_id_coalesced";')
  }
}

