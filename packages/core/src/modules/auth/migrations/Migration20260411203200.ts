import { Migration } from '@mikro-orm/migrations';

export class Migration20260411203200 extends Migration {

  override async up(): Promise<void> {
    // Remove orphaned global roles (tenantId IS NULL) before applying NOT NULL constraint.
    // Global roles never had working ACLs (RoleAcl.tenantId is NOT NULL) so no permissions are lost.
    // See: https://github.com/open-mercato/open-mercato/issues/687
    this.addSql(`delete from "role_acls" where "role_id" in (select "id" from "roles" where "tenant_id" is null);`);
    this.addSql(`delete from "user_roles" where "role_id" in (select "id" from "roles" where "tenant_id" is null);`);
    this.addSql(`delete from "role_sidebar_preferences" where "role_id" in (select "id" from "roles" where "tenant_id" is null);`);
    this.addSql(`delete from "roles" where "tenant_id" is null;`);
    this.addSql(`alter table "roles" alter column "tenant_id" drop default;`);
    this.addSql(`alter table "roles" alter column "tenant_id" type uuid using ("tenant_id"::text::uuid);`);
    this.addSql(`alter table "roles" alter column "tenant_id" set not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "roles" alter column "tenant_id" drop default;`);
    this.addSql(`alter table "roles" alter column "tenant_id" type uuid using ("tenant_id"::text::uuid);`);
    this.addSql(`alter table "roles" alter column "tenant_id" drop not null;`);
  }

}
