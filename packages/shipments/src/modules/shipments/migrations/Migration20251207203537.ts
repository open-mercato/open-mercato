import { Migration } from '@mikro-orm/migrations';

export class Migration20251207203537 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "shipment_containers" ("id" uuid not null default gen_random_uuid(), "shipment_id" uuid not null, "container_number" varchar(255) null, "container_type" text check ("container_type" in ('20GP', '40GP', '40HC', '45HC', '20RF', '40RF', '20OT', '40OT')) not null, "cargo_description" text null, "status" text check ("status" in ('EMPTY', 'STUFFED', 'GATE_IN', 'LOADED', 'IN_TRANSIT', 'DISCHARGED', 'GATE_OUT', 'DELIVERED', 'RETURNED')) not null default 'EMPTY', "current_location" varchar(255) null, "gate_in_date" timestamptz null, "loaded_on_vessel_date" timestamptz null, "discharged_date" timestamptz null, "gate_out_date" timestamptz null, "empty_return_date" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "shipment_containers_pkey" primary key ("id"));`);

    this.addSql(`alter table "shipment_containers" add constraint "shipment_containers_shipment_id_foreign" foreign key ("shipment_id") references "shipments" ("id") on update cascade;`);
  }

}
