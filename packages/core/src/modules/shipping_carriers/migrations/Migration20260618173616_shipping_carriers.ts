import { Migration } from '@mikro-orm/migrations';

export class Migration20260618173616_shipping_carriers extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "carrier_shipment_idempotency_keys" ("id" uuid not null default gen_random_uuid(), "provider_key" text not null, "idempotency_key" text not null, "request_hash" text not null, "shipment_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "carrier_shipment_idempotency_keys" add constraint "carrier_shipment_idempotency_keys_unique" unique ("idempotency_key", "provider_key", "organization_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "carrier_shipment_idempotency_keys";`);
  }

}
