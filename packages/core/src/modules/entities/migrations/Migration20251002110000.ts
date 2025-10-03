import { Migration } from '@mikro-orm/migrations';

export class Migration20251002110000 extends Migration {

  override async up(): Promise<void> {
    this.addSql('alter table "custom_entities" add column if not exists "show_in_sidebar" boolean not null default false;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "custom_entities" drop column if exists "show_in_sidebar";');
  }

}
