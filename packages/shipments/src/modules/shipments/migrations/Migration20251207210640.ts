import { Migration } from '@mikro-orm/migrations';

export class Migration20251207210640 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipment_containers" alter column "container_type" type text using ("container_type"::text);`);
    this.addSql(`alter table "shipment_containers" alter column "container_type" drop not null;`);
    this.addSql(`alter table "shipment_containers" alter column "status" drop default;`);
    this.addSql(`alter table "shipment_containers" alter column "status" type text using ("status"::text);`);
    this.addSql(`alter table "shipment_containers" alter column "status" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipment_containers" alter column "container_type" type text using ("container_type"::text);`);
    this.addSql(`alter table "shipment_containers" alter column "container_type" set not null;`);
    this.addSql(`alter table "shipment_containers" alter column "status" type text using ("status"::text);`);
    this.addSql(`alter table "shipment_containers" alter column "status" set default 'EMPTY';`);
    this.addSql(`alter table "shipment_containers" alter column "status" set not null;`);
  }

}
