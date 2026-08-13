import { Migration } from '@mikro-orm/migrations';

export class Migration20260804120546_example extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "todos" add "notes" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "todos" drop column "notes";`);
  }

}
