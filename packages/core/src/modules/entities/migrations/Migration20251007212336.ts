import { Migration } from '@mikro-orm/migrations';

export class Migration20251007212336 extends Migration {

  override async up(): Promise<void> {
    // First, remove any duplicate entries, keeping only the oldest one
    this.addSql(`
      DELETE FROM "custom_entities" a
      USING "custom_entities" b
      WHERE a.id > b.id
        AND a.entity_id = b.entity_id
        AND COALESCE(a.organization_id::text, 'NULL') = COALESCE(b.organization_id::text, 'NULL')
        AND COALESCE(a.tenant_id::text, 'NULL') = COALESCE(b.tenant_id::text, 'NULL');
    `);

    // Now create the unique constraint
    this.addSql(`create unique index "custom_entities_unique_idx" on "custom_entities" ("entity_id", "organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "custom_entities_unique_idx";`);
  }

}
