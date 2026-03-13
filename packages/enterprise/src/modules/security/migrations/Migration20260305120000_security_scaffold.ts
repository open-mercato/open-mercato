import { Migration } from '@mikro-orm/migrations'

export class Migration20260305120000SecurityScaffold extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "user_mfa_methods" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid null, "type" text not null, "label" text null, "secret" text null, "provider_metadata" jsonb null, "is_active" boolean not null default true, "last_used_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "user_mfa_methods_pkey" primary key ("id"));`)
    this.addSql(`create index "idx_user_mfa_methods_user_type" on "user_mfa_methods" ("user_id", "type", "is_active");`)
    this.addSql(`create index "idx_user_mfa_methods_tenant" on "user_mfa_methods" ("tenant_id");`)

    this.addSql(`create table "mfa_recovery_codes" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "code_hash" text not null, "is_used" boolean not null default false, "used_at" timestamptz null, "created_at" timestamptz not null, constraint "mfa_recovery_codes_pkey" primary key ("id"));`)
    this.addSql(`create index "idx_mfa_recovery_codes_user" on "mfa_recovery_codes" ("user_id", "is_used");`)

    this.addSql(`create table "mfa_enforcement_policies" ("id" uuid not null default gen_random_uuid(), "scope" text check ("scope" in ('platform', 'tenant', 'organisation')) not null, "tenant_id" uuid null, "organization_id" uuid null, "is_enforced" boolean not null default true, "allowed_methods" jsonb null, "enforcement_deadline" timestamptz null, "enforced_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "mfa_enforcement_policies_pkey" primary key ("id"));`)
    this.addSql(`create index "idx_mfa_enforcement_scope" on "mfa_enforcement_policies" ("scope", "tenant_id");`)

    this.addSql(`create table "sudo_challenge_configs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "target_type" text check ("target_type" in ('package', 'module', 'route', 'feature')) not null, "target_identifier" text not null, "is_enabled" boolean not null default true, "is_developer_default" boolean not null default false, "ttl_seconds" int not null default 300, "challenge_method" text check ("challenge_method" in ('auto', 'password', 'mfa')) not null default 'auto', "configured_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "sudo_challenge_configs_pkey" primary key ("id"));`)
    this.addSql(`create index "idx_sudo_configs_target" on "sudo_challenge_configs" ("target_type", "target_identifier");`)

    this.addSql(`create table "sudo_sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "session_token" text not null, "challenge_method" text not null, "expires_at" timestamptz not null, "created_at" timestamptz not null, constraint "sudo_sessions_pkey" primary key ("id"));`)
    this.addSql(`create index "idx_sudo_sessions_token" on "sudo_sessions" ("session_token", "expires_at");`)

    this.addSql(`create table "mfa_challenges" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "otp_code_hash" text null, "method_type" text null, "attempts" int not null default 0, "expires_at" timestamptz not null, "verified_at" timestamptz null, "created_at" timestamptz not null, constraint "mfa_challenges_pkey" primary key ("id"));`)
    this.addSql(`create index "idx_mfa_challenges_lookup" on "mfa_challenges" ("id", "expires_at");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "mfa_challenges" cascade;`)
    this.addSql(`drop table if exists "sudo_sessions" cascade;`)
    this.addSql(`drop table if exists "sudo_challenge_configs" cascade;`)
    this.addSql(`drop table if exists "mfa_enforcement_policies" cascade;`)
    this.addSql(`drop table if exists "mfa_recovery_codes" cascade;`)
    this.addSql(`drop table if exists "user_mfa_methods" cascade;`)
  }
}
