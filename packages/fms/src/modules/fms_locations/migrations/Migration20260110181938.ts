import { Migration } from '@mikro-orm/migrations';

export class Migration20260110181938 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "fms_locations" drop constraint "fms_locations_unique";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "fms_locations" add constraint "fms_locations_unique" unique ("organization_id", "tenant_id", "code");`);
  }

}
