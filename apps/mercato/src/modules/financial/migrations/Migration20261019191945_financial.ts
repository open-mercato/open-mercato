import { Migration } from '@mikro-orm/migrations';

export class Migration20261019191945_financial extends Migration {

  override name = 'Migration20261019191945';

  override up(): void | Promise<void> {
    this.addSql(`alter table "gl_journal_entries" add "source_entity_type" text null, add "source_entity_id" uuid null, add "source_kind" text null;`);
    this.addSql(`create unique index "gl_journal_entries_source_unique_idx" on "gl_journal_entries" ("organization_id", "tenant_id", "source_entity_type", "source_entity_id", "source_kind") where source_entity_id is not null and status <> 'reversed';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "gl_journal_entries_source_unique_idx";`);
    this.addSql(`alter table "gl_journal_entries" drop column "source_entity_type", drop column "source_entity_id", drop column "source_kind";`);
  }

}
