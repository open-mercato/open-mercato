import { Migration } from '@mikro-orm/migrations';

export class Migration20260928230627_marketing_automation extends Migration {

  override name = 'Migration20260928230627';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_referral_codes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "referrer_entity_id" uuid not null, "code" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "marketing_referral_referrer_uniq" on "marketing_referral_codes" ("tenant_id", "organization_id", "referrer_entity_id") where deleted_at is null;`);
    this.addSql(`create unique index "marketing_referral_code_uniq" on "marketing_referral_codes" ("tenant_id", "organization_id", "code") where deleted_at is null;`);

    this.addSql(`create table "marketing_referral_redemptions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code_id" uuid not null, "referrer_entity_id" uuid not null, "referred_entity_id" uuid not null, "status" text not null default 'pending', "order_id" uuid null, "order_total" text null, "converted_at" timestamptz null, "created_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_referral_redemptions_status_idx" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "status");`);
    this.addSql(`create index "mkt_referral_redemptions_code_idx" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "code_id");`);
    this.addSql(`create unique index "marketing_referral_referred_uniq" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "referred_entity_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_referral_redemptions" cascade;`);
    this.addSql(`drop table if exists "marketing_referral_codes" cascade;`);
  }

}
