import { Migration } from '@mikro-orm/migrations';

export class Migration20260602202147_dictionaries extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "dictionaries" add "entry_sort_mode" text not null default 'label_asc';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "dictionaries" drop column "entry_sort_mode";`);
  }

}
