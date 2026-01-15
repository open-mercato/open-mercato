import { Migration } from '@mikro-orm/migrations'

export class Migration20260115000002 extends Migration {
  override async up(): Promise<void> {
    // Set default value for category column and make it non-nullable
    this.addSql(`
      alter table "fms_documents"
      alter column "category" set default 'other',
      alter column "category" set not null;
    `)

    // Update any existing NULL values to 'other'
    this.addSql(`
      update "fms_documents"
      set "category" = 'other'
      where "category" is null;
    `)
  }

  override async down(): Promise<void> {
    // Revert changes
    this.addSql(`
      alter table "fms_documents"
      alter column "category" drop default,
      alter column "category" drop not null;
    `)
  }
}
