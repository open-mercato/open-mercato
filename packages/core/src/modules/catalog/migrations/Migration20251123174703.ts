import { Migration } from '@mikro-orm/migrations';

export class Migration20251123174703 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index "catalog_price_kinds_scope_idx";`);
    this.addSql(`alter table "catalog_price_kinds" drop constraint "catalog_price_kinds_code_scope_unique";`);

    this.addSql(`alter table "catalog_price_kinds" alter column "organization_id" drop default;`);
    this.addSql(`alter table "catalog_price_kinds" alter column "organization_id" type uuid using ("organization_id"::text::uuid);`);
    this.addSql(`alter table "catalog_price_kinds" alter column "organization_id" drop not null;`);
    this.addSql(`create index "catalog_price_kinds_tenant_idx" on "catalog_price_kinds" ("tenant_id");`);
    this.addSql(`alter table "catalog_price_kinds" add constraint "catalog_price_kinds_code_tenant_unique" unique ("tenant_id", "code");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "catalog_price_kinds_tenant_idx";`);
    this.addSql(`alter table "catalog_price_kinds" drop constraint "catalog_price_kinds_code_tenant_unique";`);

    this.addSql(`alter table "catalog_price_kinds" alter column "organization_id" drop default;`);
    this.addSql(`alter table "catalog_price_kinds" alter column "organization_id" type uuid using ("organization_id"::text::uuid);`);
    this.addSql(`alter table "catalog_price_kinds" alter column "organization_id" set not null;`);
    this.addSql(`create index "catalog_price_kinds_scope_idx" on "catalog_price_kinds" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_price_kinds" add constraint "catalog_price_kinds_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);
  }

}
