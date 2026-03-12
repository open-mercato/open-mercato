import { Migration } from '@mikro-orm/migrations';

export class Migration20260312231437 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "perspectives" add column "is_shared" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "perspectives" drop column "is_shared";`);
  }

}
