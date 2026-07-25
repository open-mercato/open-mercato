import { Migration } from '@mikro-orm/migrations';

export class Migration20260716120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "custom_entities" add column "access_restricted" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "custom_entities" drop column "access_restricted";`);
  }

}
