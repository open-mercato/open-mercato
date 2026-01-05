import { Migration } from '@mikro-orm/migrations';

export class Migration20251206232517 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint if exists "shipments_status_check";`);

    this.addSql(`alter table "shipments" add column "bol_number" varchar(255) null, add column "carrier" varchar(255) null, add column "origin_port" varchar(255) null, add column "destination_port" varchar(255) null, add column "shipper_name" varchar(255) null, add column "consignee_name" varchar(255) null, add column "contact_person" varchar(255) null, add column "weight" numeric(10,0) null, add column "volume" numeric(10,0) null, add column "total_pieces" int null, add column "total_actual_weight" numeric(10,0) null, add column "total_chargeable_weight" numeric(10,0) null, add column "total_volume" numeric(10,0) null, add column "actual_weight_per_kilo" numeric(10,0) null, add column "amount" numeric(10,0) null, add column "mode" varchar(255) null, add column "vessel_name" varchar(255) null, add column "voyage_number" varchar(255) null, add column "incoterms" varchar(255) null, add column "request_date" timestamptz null;`);
    this.addSql(`alter table "shipments" add constraint "shipments_status_check" check("status" in ('ORDERED', 'BOOKED', 'LOADING', 'DEPARTED', 'TRANSSHIPMENT', 'PRE_ARRIVAL', 'IN_PORT', 'DELIVERED'));`);
    this.addSql(`alter table "shipments" rename column "carrier_name" to "client_reference";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint if exists "shipments_status_check";`);

    this.addSql(`alter table "shipments" drop column "bol_number", drop column "carrier", drop column "origin_port", drop column "destination_port", drop column "shipper_name", drop column "consignee_name", drop column "contact_person", drop column "weight", drop column "volume", drop column "total_pieces", drop column "total_actual_weight", drop column "total_chargeable_weight", drop column "total_volume", drop column "actual_weight_per_kilo", drop column "amount", drop column "mode", drop column "vessel_name", drop column "voyage_number", drop column "incoterms", drop column "request_date";`);

    this.addSql(`alter table "shipments" add constraint "shipments_status_check" check("status" in ('BOOKED', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED'));`);
    this.addSql(`alter table "shipments" rename column "client_reference" to "carrier_name";`);
  }

}
