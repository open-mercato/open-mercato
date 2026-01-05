import { Migration } from '@mikro-orm/migrations';

export class Migration20251202191547 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "shipments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "internal_reference" varchar(255) null, "client" varchar(255) null, "order" varchar(255) null, "booking_number" varchar(255) null, "container_number" varchar(255) null, "origin_location" varchar(255) null, "destination_location" varchar(255) null, "etd" timestamptz null, "atd" timestamptz null, "eta" timestamptz null, "ata" timestamptz null, "status" text check ("status" in ('BOOKED', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED')) not null default 'BOOKED', "container_type" text check ("container_type" in ('20FT', '40FT', '40FT_HC', '45FT')) not null, "carrier_name" varchar(255) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "shipments_pkey" primary key ("id"));`);
  }
}
