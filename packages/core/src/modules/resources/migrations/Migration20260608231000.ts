import { Migration } from '@mikro-orm/migrations';

export class Migration20260608231000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "resources_resources" add column "custom_fieldset_code" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "resources_resources" drop column "custom_fieldset_code";`);
  }

}
