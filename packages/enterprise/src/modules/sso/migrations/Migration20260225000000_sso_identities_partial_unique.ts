import { Migration } from '@mikro-orm/migrations';

export class Migration20260225000000_sso_identities_partial_unique extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sso_identities" drop constraint "sso_identities_config_user_unique";`);
    this.addSql(`alter table "sso_identities" drop constraint "sso_identities_config_subject_unique";`);
    this.addSql(`alter table "sso_identities" drop constraint "sso_identities_config_external_id_unique";`);

    this.addSql(`create unique index "sso_identities_config_user_unique" on "sso_identities" ("sso_config_id", "user_id") where "deleted_at" is null;`);
    this.addSql(`create unique index "sso_identities_config_subject_unique" on "sso_identities" ("sso_config_id", "idp_subject") where "deleted_at" is null;`);
    this.addSql(`create unique index "sso_identities_config_external_id_unique" on "sso_identities" ("sso_config_id", "external_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "sso_identities_config_user_unique";`);
    this.addSql(`drop index "sso_identities_config_subject_unique";`);
    this.addSql(`drop index "sso_identities_config_external_id_unique";`);

    this.addSql(`alter table "sso_identities" add constraint "sso_identities_config_user_unique" unique ("sso_config_id", "user_id");`);
    this.addSql(`alter table "sso_identities" add constraint "sso_identities_config_subject_unique" unique ("sso_config_id", "idp_subject");`);
    this.addSql(`alter table "sso_identities" add constraint "sso_identities_config_external_id_unique" unique ("sso_config_id", "external_id");`);
  }

}
