import { Migration } from '@mikro-orm/migrations';

export class Migration20260222000000_sso_add_name extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sso_configs" add column "name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sso_configs" drop column "name";`);
  }

}
