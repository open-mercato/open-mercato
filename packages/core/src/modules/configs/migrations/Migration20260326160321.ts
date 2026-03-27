import { Migration } from '@mikro-orm/migrations';

export class Migration20260326160321 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "module_configs" drop constraint "module_configs_module_name_unique";`);

    this.addSql(`alter table "module_configs" add column "organization_id" uuid null;`);
    this.addSql(`alter table "module_configs" add constraint "module_configs_module_name_org_unique" unique ("module_id", "name", "organization_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "module_configs" drop constraint "module_configs_module_name_org_unique";`);
    this.addSql(`alter table "module_configs" drop column "organization_id";`);

    this.addSql(`alter table "module_configs" add constraint "module_configs_module_name_unique" unique ("module_id", "name");`);
  }

}
