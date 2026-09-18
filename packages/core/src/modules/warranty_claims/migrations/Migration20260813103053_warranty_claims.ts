import { Migration } from '@mikro-orm/migrations';

export class Migration20260813103053_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "warranty_claim_sla_signals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "claim_id" uuid not null, "event_id" text not null, "cycle_key" text not null, "payload" jsonb not null, "lease_token" uuid null, "lease_expires_at" timestamptz null, "published_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "warranty_claim_sla_signals_pending_scope_idx" on "warranty_claim_sla_signals" ("tenant_id", "organization_id", "published_at", "created_at");`);
    this.addSql(`alter table "warranty_claim_sla_signals" add constraint "warranty_claim_sla_signals_claim_event_cycle_unique" unique ("tenant_id", "organization_id", "claim_id", "event_id", "cycle_key");`);
  }

}
