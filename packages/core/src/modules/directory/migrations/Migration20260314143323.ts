import { Migration } from '@mikro-orm/migrations';

export class Migration20260314143323 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "organizations" add column "slug" text null;`);
    this.addSql(`alter table "organizations" add constraint "organizations_tenant_slug_uniq" unique ("tenant_id", "slug");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop constraint "organizations_tenant_slug_uniq";`);
    this.addSql(`alter table "organizations" drop column "slug";`);
  }

}
