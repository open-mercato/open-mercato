import { Migration } from '@mikro-orm/migrations';

export class Migration20251009171004 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "roles" add column "tenant_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "roles" drop column "tenant_id";`);
  }

}
