import { Migration } from '@mikro-orm/migrations';

export class Migration20260224000000_sso_external_id extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sso_identities" add column "external_id" text null;`);
    this.addSql(`alter table "sso_identities" add constraint "sso_identities_config_external_id_unique" unique ("sso_config_id", "external_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sso_identities" drop constraint if exists "sso_identities_config_external_id_unique";`);
    this.addSql(`alter table "sso_identities" drop column if exists "external_id";`);
  }

}
