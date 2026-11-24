import { Migration } from '@mikro-orm/migrations';

export class Migration20261124145207_security extends Migration {

  override name = 'Migration20261124145207';

  override up(): void | Promise<void> {
    this.addSql(`create table "security_known_devices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "device_key" text not null, "first_seen_at" timestamptz not null, "last_seen_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "sec_known_device_last_seen" on "security_known_devices" ("last_seen_at");`);
    this.addSql(`alter table "security_known_devices" add constraint "sec_known_device_identity_unique" unique ("tenant_id", "user_id", "device_key");`);

    this.addSql(`create table "security_sign_in_attempts" ("id" uuid not null default gen_random_uuid(), "source_attempt_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid null, "user_id" uuid null, "email" text not null, "email_hash" text not null, "result" text not null, "reason" text null, "ip_address" text null, "ip_hash" text null, "user_agent" text null, "browser_name" text null, "browser_major" text null, "os_name" text null, "device_type" text not null, "device_key" text not null, "is_new_device" boolean not null default false, "mfa_status" text null, "occurred_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "sec_sign_in_attempt_occurred" on "security_sign_in_attempts" ("occurred_at");`);
    this.addSql(`create index "sec_sign_in_attempt_tenant_ip_hash" on "security_sign_in_attempts" ("tenant_id", "ip_hash");`);
    this.addSql(`create index "sec_sign_in_attempt_tenant_user_occurred" on "security_sign_in_attempts" ("tenant_id", "user_id", "occurred_at");`);
    this.addSql(`create index "sec_sign_in_attempt_tenant_occurred" on "security_sign_in_attempts" ("tenant_id", "occurred_at");`);
    this.addSql(`alter table "security_sign_in_attempts" add constraint "sec_sign_in_attempt_source_unique" unique ("tenant_id", "source_attempt_id");`);

    this.addSql(`create table "security_sign_in_mfa_receipts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "user_id" uuid not null, "source_attempt_id" uuid not null, "challenge_id" uuid null, "status" text not null, "verified_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "sec_sign_in_mfa_receipt_created" on "security_sign_in_mfa_receipts" ("created_at");`);
    this.addSql(`alter table "security_sign_in_mfa_receipts" add constraint "sec_sign_in_mfa_receipt_challenge_unique" unique ("tenant_id", "challenge_id");`);
    this.addSql(`alter table "security_sign_in_mfa_receipts" add constraint "sec_sign_in_mfa_receipt_source_unique" unique ("tenant_id", "source_attempt_id");`);

    this.addSql(`create table "security_sign_in_notification_intents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "user_id" uuid not null, "source_attempt_id" uuid not null, "known_device_id" uuid not null, "status" text not null, "created_at" timestamptz not null, "delivered_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "sec_sign_in_notification_status_created" on "security_sign_in_notification_intents" ("status", "created_at");`);
    this.addSql(`alter table "security_sign_in_notification_intents" add constraint "sec_sign_in_notification_device_unique" unique ("tenant_id", "known_device_id");`);

    this.addSql(`alter table "mfa_challenges" add "sign_in_attempt_id" uuid null;`);
    this.addSql(`alter table "mfa_challenges" add constraint "mfa_challenges_tenant_sign_in_attempt_unique" unique ("tenant_id", "sign_in_attempt_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "security_sign_in_notification_intents";`);
    this.addSql(`drop table if exists "security_sign_in_mfa_receipts";`);
    this.addSql(`drop table if exists "security_sign_in_attempts";`);
    this.addSql(`drop table if exists "security_known_devices";`);
    this.addSql(`alter table "mfa_challenges" drop constraint if exists "mfa_challenges_tenant_sign_in_attempt_unique";`);
    this.addSql(`alter table "mfa_challenges" drop column "sign_in_attempt_id";`);
  }

}
