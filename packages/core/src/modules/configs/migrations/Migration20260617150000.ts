import { Migration } from '@mikro-orm/migrations';

export class Migration20260617150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "module_configs" add column "organization_id" uuid null, add column "tenant_id" uuid null;`);
    this.addSql(`alter table "module_configs" drop constraint "module_configs_module_name_unique";`);
    this.addSql(`create unique index "module_configs_global_unique" on "module_configs" ("module_id", "name") where "tenant_id" is null;`);
    this.addSql(`create unique index "module_configs_scoped_unique" on "module_configs" ("module_id", "name", "tenant_id") where "tenant_id" is not null;`);
    this.addSql(`create index "module_configs_module_name_tenant_idx" on "module_configs" ("module_id", "name", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "module_configs_module_name_tenant_idx";`);
    this.addSql(`drop index if exists "module_configs_scoped_unique";`);
    this.addSql(`drop index if exists "module_configs_global_unique";`);
    this.addSql(`alter table "module_configs" add constraint "module_configs_module_name_unique" unique ("module_id", "name");`);
    this.addSql(`alter table "module_configs" drop column "organization_id", drop column "tenant_id";`);
  }

}
