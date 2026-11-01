import { Migration } from '@mikro-orm/migrations';

export class Migration20261027120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "checkout_sessions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "token_hash" text not null, "cart_id" uuid null, "store_id" uuid null, "link_id" uuid null, "channel" text not null, "status" text not null default 'open', "step" text not null default 'contact', "currency_code" text not null, "locale" text not null, "email" text null, "phone" text null, "customer_id" uuid null, "customer_user_id" uuid null, "shipping_address" jsonb null, "billing_address" jsonb null, "billing_same_as_shipping" boolean not null default false, "shipping_method" jsonb null, "quoted_totals" jsonb null, "delivery_window_id" uuid null, "payment_method_code" text null, "payment_intent_ref" text null, "payment_expires_at" timestamptz null, "purchase_order_number" text null, "credit_reservation_key" text null, "stock_reservation_key" text null, "submit_idempotency_key" text null, "submit_attempt" int not null default 0, "submit_progress" text null, "submit_started_at" timestamptz null, "outcome_kind" text null, "sales_order_id" uuid null, "sales_quote_id" uuid null, "terms_accepted_at" timestamptz null, "consent_flags" jsonb null, "failure_code" text null, "failure_detail" text null, "expires_at" timestamptz not null, "completed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "checkout_sessions_pkey" primary key ("id"));`);
    this.addSql(`create unique index "checkout_sessions_token_hash_index" on "checkout_sessions" ("token_hash");`);
    this.addSql(`create unique index "checkout_sessions_tenant_id_submit_idempotency_ke_index" on "checkout_sessions" ("tenant_id", "submit_idempotency_key") where submit_idempotency_key is not null;`);
    this.addSql(`create index "checkout_sessions_tenant_id_status_expires_at_index" on "checkout_sessions" ("tenant_id", "status", "expires_at");`);
    this.addSql(`create index "checkout_sessions_tenant_id_cart_id_status_index" on "checkout_sessions" ("tenant_id", "cart_id", "status");`);

    this.addSql(`create table "checkout_session_events" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "session_id" uuid not null, "kind" text not null, "payload" jsonb null, "actor" text not null, "created_at" timestamptz not null, constraint "checkout_session_events_pkey" primary key ("id"));`);
    this.addSql(`create index "checkout_session_events_tenant_id_organization_id__index" on "checkout_session_events" ("tenant_id", "organization_id", "session_id", "created_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_session_events" cascade;`);
    this.addSql(`drop table if exists "checkout_sessions" cascade;`);
  }

}
