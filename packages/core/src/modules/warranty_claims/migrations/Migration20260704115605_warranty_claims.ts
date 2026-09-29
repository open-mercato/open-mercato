import { Migration } from '@mikro-orm/migrations';

export class Migration20260704115605_warranty_claims extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "warranty_claim_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "sla_hours" int not null default 48, "sla_pause_on_info_requested" boolean not null default true, "sla_at_risk_threshold_pct" int not null default 75, "auto_approve_enabled" boolean not null default false, "auto_approve_max_amount" numeric(18,4) null, "auto_approve_currency_code" text null, "auto_approve_require_in_warranty" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "warranty_claim_settings" add constraint "warranty_claim_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`alter table "warranty_claims" add "sla_paused_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "warranty_claims" drop column "sla_paused_at";`);
    this.addSql(`drop table if exists "warranty_claim_settings" cascade;`);
  }

}
