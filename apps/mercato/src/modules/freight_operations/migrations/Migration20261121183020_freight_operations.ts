import { Migration } from '@mikro-orm/migrations';

export class Migration20261121183020_freight_operations extends Migration {

  override name = 'Migration20261121183020';

  override up(): void | Promise<void> {
    this.addSql(`create table "freight_delivery_notes" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "note_number" text not null, "status" text not null default 'draft', "freight_order_id" uuid null, "freight_trip_id" uuid null, "order_number_snapshot" text null, "trip_number_snapshot" text null, "customer_id" uuid not null, "customer_snapshot" jsonb not null, "seller_snapshot" jsonb not null, "consignee_name" text null, "consignee_phone" text null, "consignee_address" text null, "origin" text not null, "destination" text not null, "requested_pickup_at" timestamptz null, "requested_delivery_at" timestamptz null, "cargo_description" text not null, "cargo_quantity" numeric(18,3) null, "cargo_unit" text null, "cargo_weight_kg" numeric(18,3) null, "cargo_volume_m3" numeric(18,3) null, "cargo_hazardous" boolean not null default false, "cargo_refrigerated" boolean not null default false, "seal_number" text null, "vehicle_id" uuid null, "driver_id" uuid null, "vehicle_snapshot" jsonb null, "driver_snapshot" jsonb null, "issued_at" timestamptz null, "delivered_at" timestamptz null, "received_by_name" text null, "received_by_id_number" text null, "pod_reference" text null, "pod_document_id" uuid null, "pop_reference" text null, "pop_document_id" uuid null, "external_waybill_number" text null, "external_waybill_status" text not null default 'not_recorded', "external_waybill_url" text null, "external_waybill_recorded_at" timestamptz null, "external_waybill_cancelled_at" timestamptz null, "external_waybill_notes" text null, "cancellation_reason" text null, "cancelled_at" timestamptz null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "freight_delivery_notes_number_unique_idx" on "freight_delivery_notes" ("organization_id", "tenant_id", "note_number") where deleted_at is null;`);
    this.addSql(`create index "freight_delivery_notes_customer_idx" on "freight_delivery_notes" ("organization_id", "customer_id");`);
    this.addSql(`create index "freight_delivery_notes_trip_idx" on "freight_delivery_notes" ("organization_id", "freight_trip_id");`);
    this.addSql(`create index "freight_delivery_notes_order_idx" on "freight_delivery_notes" ("organization_id", "freight_order_id");`);
    this.addSql(`create index "freight_delivery_notes_status_idx" on "freight_delivery_notes" ("organization_id", "status");`);
    this.addSql(`create index "freight_delivery_notes_tenant_org_idx" on "freight_delivery_notes" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "freight_document_sequences" drop constraint if exists "freight_document_sequences_kind_check";`);
    this.addSql(`alter table "freight_document_sequences" add constraint "freight_document_sequences_kind_check" check ("kind" in ('order', 'contract', 'trip', 'abstract', 'delivery_note'));`);

    this.addSql(`alter table "freight_delivery_notes" add constraint "freight_delivery_notes_status_check" check ("status" in ('draft', 'issued', 'delivered', 'cancelled'));`);
    this.addSql(`alter table "freight_delivery_notes" add constraint "freight_delivery_notes_cargo_unit_check" check ("cargo_unit" in ('trip', 'ton', 'kg', 'm3', 'pallet', 'container', 'other'));`);
    this.addSql(`alter table "freight_delivery_notes" add constraint "freight_delivery_notes_external_waybill_status_check" check ("external_waybill_status" in ('not_recorded', 'recorded', 'cancelled'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "freight_delivery_notes" cascade;`);
    this.addSql(`alter table "freight_document_sequences" drop constraint if exists "freight_document_sequences_kind_check";`);
    this.addSql(`alter table "freight_document_sequences" add constraint "freight_document_sequences_kind_check" check ("kind" in ('order', 'contract', 'trip', 'abstract'));`);
  }

}
