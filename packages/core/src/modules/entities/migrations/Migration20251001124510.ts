import { Migration } from '@mikro-orm/migrations'

export class Migration20251001124510 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "custom_entities" add column if not exists "label_field" text null;')
    this.addSql('alter table "custom_entities" add column if not exists "default_editor" text null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "custom_entities" drop column if exists "default_editor";')
    this.addSql('alter table "custom_entities" drop column if exists "label_field";')
  }
}

