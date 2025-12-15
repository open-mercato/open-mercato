import { Migration } from '@mikro-orm/migrations';

export class Migration20251207203657 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipment_containers" add column "tenant_id" uuid not null, add column "organization_id" uuid not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipment_containers" drop column "tenant_id", drop column "organization_id";`);
  }

}
