import { Migration } from '@mikro-orm/migrations';

export class Migration20260108210800 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "fms_quotes" add column "client_name" text null, add column "container_count" int null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_quotes" drop column "client_name", drop column "container_count";`);
  }

}
