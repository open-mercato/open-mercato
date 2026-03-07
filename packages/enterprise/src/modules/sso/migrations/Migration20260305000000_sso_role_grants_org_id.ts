import { Migration } from '@mikro-orm/migrations';

export class Migration20260305000000_sso_role_grants_org_id extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sso_role_grants" add column "organization_id" uuid not null default '00000000-0000-0000-0000-000000000000';`);
    this.addSql(`alter table "sso_role_grants" alter column "organization_id" drop default;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sso_role_grants" drop column "organization_id";`);
  }

}
