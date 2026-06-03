import { Migration } from '@mikro-orm/migrations';

export class Migration20260413111602 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "staff_time_projects" add column "color" varchar(20) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "staff_time_projects" drop column "color";`);
  }

}
