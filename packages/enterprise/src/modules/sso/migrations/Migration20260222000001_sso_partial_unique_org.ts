import { Migration } from '@mikro-orm/migrations';

export class Migration20260222000001_sso_partial_unique_org extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sso_configs" drop constraint "sso_configs_organization_id_unique";`);
    this.addSql(`create unique index "sso_configs_organization_id_unique" on "sso_configs" ("organization_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "sso_configs_organization_id_unique";`);
    this.addSql(`alter table "sso_configs" add constraint "sso_configs_organization_id_unique" unique ("organization_id");`);
  }

}
