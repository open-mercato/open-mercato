import { Migration } from '@mikro-orm/migrations'

export class Migration20260218002838 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "record_locks" ("id" uuid not null default gen_random_uuid(), "resource_kind" text not null, "resource_id" text not null, "token" text not null, "strategy" text not null default 'optimistic', "status" text not null default 'active', "locked_by_user_id" uuid not null, "base_action_log_id" uuid null, "locked_at" timestamptz not null, "last_heartbeat_at" timestamptz not null, "expires_at" timestamptz not null, "released_at" timestamptz null, "released_by_user_id" uuid null, "release_reason" text null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "record_locks_pkey" primary key ("id"));`)
    this.addSql(`create index "record_locks_expiry_status_idx" on "record_locks" ("tenant_id", "expires_at", "status");`)
    this.addSql(`create index "record_locks_owner_status_idx" on "record_locks" ("tenant_id", "locked_by_user_id", "status");`)
    this.addSql(`create index "record_locks_resource_status_idx" on "record_locks" ("tenant_id", "resource_kind", "resource_id", "status");`)
    this.addSql(`alter table "record_locks" add constraint "record_locks_token_unique" unique ("token");`)

    this.addSql(`create table "record_lock_conflicts" ("id" uuid not null default gen_random_uuid(), "resource_kind" text not null, "resource_id" text not null, "status" text not null default 'pending', "resolution" text null, "base_action_log_id" uuid null, "incoming_action_log_id" uuid null, "conflict_actor_user_id" uuid not null, "incoming_actor_user_id" uuid null, "resolved_by_user_id" uuid null, "resolved_at" timestamptz null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "record_lock_conflicts_pkey" primary key ("id"));`)
    this.addSql(`create index "record_lock_conflicts_users_idx" on "record_lock_conflicts" ("tenant_id", "conflict_actor_user_id", "incoming_actor_user_id", "created_at");`)
    this.addSql(`create index "record_lock_conflicts_resource_idx" on "record_lock_conflicts" ("tenant_id", "resource_kind", "resource_id", "status", "created_at");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "record_lock_conflicts" cascade;`)
    this.addSql(`drop table if exists "record_locks" cascade;`)
  }
}
