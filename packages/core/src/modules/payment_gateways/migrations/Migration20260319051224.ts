import { Migration } from '@mikro-orm/migrations';

export class Migration20260319051224 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "gateway_transaction_assignments" ("id" uuid not null default gen_random_uuid(), "transaction_id" uuid not null, "entity_type" text not null, "entity_id" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "gateway_transaction_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "gateway_transaction_assignments_unique" on "gateway_transaction_assignments" ("transaction_id", "entity_type", "entity_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "gateway_transaction_assignments_entity_scope_idx" on "gateway_transaction_assignments" ("entity_type", "entity_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "gateway_transaction_assignments_tx_scope_idx" on "gateway_transaction_assignments" ("transaction_id", "organization_id", "tenant_id");`);
  }

}
