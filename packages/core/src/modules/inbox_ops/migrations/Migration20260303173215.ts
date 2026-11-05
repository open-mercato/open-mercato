import { Migration } from '@mikro-orm/migrations';

export class Migration20260303173215 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "inbox_proposals" add column "category" text null;`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_category_index" on "inbox_proposals" ("organization_id", "tenant_id", "category");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "inbox_proposals_organization_id_tenant_id_category_index";`);
    this.addSql(`alter table "inbox_proposals" drop column "category";`);
  }

}
