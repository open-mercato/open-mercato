import { Migration } from '@mikro-orm/migrations';

export class Migration20251207142248 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" drop column "client", drop column "shipper_name", drop column "consignee_name", drop column "contact_person";`);

    this.addSql(`alter table "shipments" add column "shipper_id" uuid null, add column "consignee_id" uuid null, add column "contact_person_id" uuid null, add column "vessel_imo" numeric(10,0) null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_shipper_id_foreign" foreign key ("shipper_id") references "customer_entities" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_consignee_id_foreign" foreign key ("consignee_id") references "customer_entities" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_contact_person_id_foreign" foreign key ("contact_person_id") references "customer_entities" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint "shipments_shipper_id_foreign";`);
    this.addSql(`alter table "shipments" drop constraint "shipments_consignee_id_foreign";`);
    this.addSql(`alter table "shipments" drop constraint "shipments_contact_person_id_foreign";`);

    this.addSql(`alter table "shipments" drop column "shipper_id", drop column "consignee_id", drop column "contact_person_id", drop column "vessel_imo";`);

    this.addSql(`alter table "shipments" add column "client" varchar(255) null, add column "shipper_name" varchar(255) null, add column "consignee_name" varchar(255) null, add column "contact_person" varchar(255) null;`);
  }

}
