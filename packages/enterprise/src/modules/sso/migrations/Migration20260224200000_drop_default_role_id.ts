import { Migration } from '@mikro-orm/migrations';

export class Migration20260224200000_drop_default_role_id extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sso_configs" drop column if exists "default_role_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sso_configs" add column "default_role_id" uuid null;`);
  }

}
