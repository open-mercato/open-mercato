import { Migration } from '@mikro-orm/migrations';

export class Migration20260224100000_sso_role_grants extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sso_role_grants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "user_id" uuid not null, "role_id" uuid not null, "sso_config_id" uuid not null, "created_at" timestamptz not null, constraint "sso_role_grants_pkey" primary key ("id"));`);
    this.addSql(`create index "sso_role_grants_user_id_idx" on "sso_role_grants" ("user_id");`);
    this.addSql(`alter table "sso_role_grants" add constraint "sso_role_grants_user_role_config_unique" unique ("user_id", "role_id", "sso_config_id");`);

    this.addSql(`alter table "sso_configs" add column "app_role_mappings" jsonb not null default '{}';`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sso_role_grants";`);
    this.addSql(`alter table "sso_configs" drop column "app_role_mappings";`);
  }

}
