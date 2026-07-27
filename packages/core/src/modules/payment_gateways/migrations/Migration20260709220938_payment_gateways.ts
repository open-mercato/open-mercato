import { Migration } from '@mikro-orm/migrations';

export class Migration20260709220938_payment_gateways extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "gateway_session_initializations" ("id" uuid not null default gen_random_uuid(), "operation_key" text not null, "provider_key" text not null, "claim_token" uuid null, "claimed_at" timestamptz null, "gateway_transaction_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "gateway_session_initializations" add constraint "gateway_session_initializations_scope_operation_unique" unique ("operation_key", "provider_key", "organization_id", "tenant_id");`);
  }

}
