import { Migration } from '@mikro-orm/migrations';

export class Migration20260709220735_payment_gateways extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "gateway_payment_operations" ("id" uuid not null default gen_random_uuid(), "operation_id" text not null, "transaction_id" uuid not null, "operation_type" text not null, "provider_key" text not null, "request_hash" text not null, "provider_idempotency_key" text not null, "status" text not null default 'in_progress', "attempt_token" text not null, "attempt_count" int not null default 1, "result" jsonb null, "lease_expires_at" timestamptz null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "gateway_payment_operations_status_lease_expires_at_index" on "gateway_payment_operations" ("status", "lease_expires_at");`);
    this.addSql(`create index "gateway_payment_operations_transaction_id_operatio_615c8_index" on "gateway_payment_operations" ("transaction_id", "operation_type", "organization_id", "tenant_id");`);
    this.addSql(`alter table "gateway_payment_operations" add constraint "gateway_payment_operations_scope_operation_unique" unique ("operation_id", "organization_id", "tenant_id");`);
  }

}
