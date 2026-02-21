import { Migration } from '@mikro-orm/migrations';

export class Migration20260221011929 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "ecommerce_checkout_sessions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "cart_id" uuid not null, "cart_token" uuid not null, "workflow_name" text not null default 'ecommerce.checkout.v1', "workflow_state" text not null default 'cart', "status" text not null default 'active', "version" int not null default 1, "customer_info" jsonb null, "shipping_info" jsonb null, "billing_info" jsonb null, "metadata" jsonb null, "idempotency_key" text null, "placed_order_id" uuid null, "expires_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ecommerce_checkout_sessions_pkey" primary key ("id"));`);
    this.addSql(`create index "ecommerce_checkout_sessions_cart_status_idx" on "ecommerce_checkout_sessions" ("cart_id", "status");`);
    this.addSql(`create index "ecommerce_checkout_sessions_tenant_org_store_status_idx" on "ecommerce_checkout_sessions" ("tenant_id", "organization_id", "store_id", "status");`);
  }

}
