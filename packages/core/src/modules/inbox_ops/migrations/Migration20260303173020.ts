import { Migration } from '@mikro-orm/migrations';

export class Migration20260303173020 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create index "inbox_discrepancies_organization_id_tenant_id_index" on "inbox_discrepancies" ("organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "inbox_discrepancies_organization_id_tenant_id_index";`);
  }

}
