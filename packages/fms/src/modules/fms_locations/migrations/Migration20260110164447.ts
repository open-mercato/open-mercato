import { Migration } from '@mikro-orm/migrations';

export class Migration20260110164447 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "fms_locations" drop column "quadrant";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_locations" add column "quadrant" text not null;`);
  }

}
