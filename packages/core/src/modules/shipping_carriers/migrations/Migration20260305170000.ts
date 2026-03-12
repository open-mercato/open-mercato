import { Migration } from '@mikro-orm/migrations'

export class Migration20260305170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "carrier_shipments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "provider_key" text not null, "carrier_shipment_id" text not null, "tracking_number" text not null, "unified_status" text not null default 'label_created', "carrier_status" text null, "label_url" text null, "label_data" text null, "tracking_events" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "last_webhook_at" timestamptz null, "last_polled_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "carrier_shipments_pkey" primary key ("id"));`)
    this.addSql(`create index "carrier_shipments_organization_id_tenant_id_unif_b5ab4_index" on "carrier_shipments" ("organization_id", "tenant_id", "unified_status");`)
    this.addSql(`create index "carrier_shipments_provider_key_carrier_shipment_i_f9f17_index" on "carrier_shipments" ("provider_key", "carrier_shipment_id", "organization_id");`)
    this.addSql(`create index "carrier_shipments_order_id_organization_id_tenant_id_index" on "carrier_shipments" ("order_id", "organization_id", "tenant_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "carrier_shipments";`)
  }
}
