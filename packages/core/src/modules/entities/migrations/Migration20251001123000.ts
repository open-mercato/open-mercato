import { Migration } from '@mikro-orm/migrations';

export class Migration20251001123000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "custom_entities" add column "default_editor" text null;')
  }
  override async down(): Promise<void> {
    this.addSql('alter table "custom_entities" drop column if exists "default_editor";')
  }
}

