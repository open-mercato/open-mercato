import { Migration } from '@mikro-orm/migrations';

export class Migration20261027150000_assisted_selling extends Migration {

  override name = 'Migration20261027150000';

  override up(): void | Promise<void> {
    this.addSql(`create table "assisted_selling_threads" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "buyer_cart_id" uuid not null, "customer_id" uuid null, "customer_user_id" uuid null, "status" text not null default 'open', "mode_snapshot" text not null, "assigned_actor_id" uuid null, "live_proposal_count" int not null default 0, "last_activity_at" timestamptz not null, "closed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "assisted_selling_threads_tenant_org_idx" on "assisted_selling_threads" ("tenant_id", "organization_id");`);
    this.addSql(`create index "assisted_selling_threads_store_status_activity_idx" on "assisted_selling_threads" ("tenant_id", "store_id", "status", "last_activity_at");`);
    this.addSql(`create index "assisted_selling_threads_store_assignee_status_idx" on "assisted_selling_threads" ("tenant_id", "store_id", "assigned_actor_id", "status");`);
    this.addSql(`create unique index "assisted_selling_threads_open_buyer_cart_unique_idx" on "assisted_selling_threads" ("tenant_id", "buyer_cart_id") where "status" = 'open';`);

    this.addSql(`create table "assisted_selling_participants" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "thread_id" uuid not null, "actor_type" text not null, "actor_id" uuid null, "display_name" text not null, "joined_at" timestamptz not null, "left_at" timestamptz null, "presence_state" text not null default 'absent', "presence_updated_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "assisted_selling_participants_tenant_org_idx" on "assisted_selling_participants" ("tenant_id", "organization_id");`);
    this.addSql(`create index "assisted_selling_participants_thread_idx" on "assisted_selling_participants" ("thread_id");`);
    this.addSql(`create unique index "assisted_selling_participants_thread_actor_unique_idx" on "assisted_selling_participants" ("thread_id", "actor_type", "actor_id") where "deleted_at" is null;`);

    this.addSql(`create table "assisted_selling_messages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "thread_id" uuid not null, "participant_id" uuid not null, "body" text not null, "body_format" text not null default 'text', "proposal_id" uuid null, "sent_at" timestamptz not null, "ai_input_flagged_at" timestamptz null, "ai_read_by_turn_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "assisted_selling_messages_thread_sent_idx" on "assisted_selling_messages" ("tenant_id", "thread_id", "sent_at", "id");`);

    this.addSql(`create table "assisted_selling_proposals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "thread_id" uuid not null, "proposal_cart_id" uuid not null, "target_cart_id" uuid not null, "authored_by_actor_type" text not null, "authored_by_actor_id" uuid not null, "approved_by_actor_id" uuid null, "status" text not null default 'published', "published_at" timestamptz not null, "expires_at" timestamptz not null, "idempotency_key" text not null, "request_digest" text not null, "response_snapshot" jsonb null, "resolved_at" timestamptz null, "rejection_reason" text null, "ai_pending_action_id" uuid null, "superseded_by_proposal_id" uuid null, "merge_log_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "assisted_selling_proposals" add constraint "assisted_selling_proposals_proposal_cart_id_unique" unique ("tenant_id", "proposal_cart_id");`);
    this.addSql(`alter table "assisted_selling_proposals" add constraint "assisted_selling_proposals_thread_idempotency_key_unique" unique ("tenant_id", "thread_id", "idempotency_key");`);
    this.addSql(`create index "assisted_selling_proposals_target_status_idx" on "assisted_selling_proposals" ("tenant_id", "target_cart_id", "status");`);
    this.addSql(`create index "assisted_selling_proposals_status_expires_idx" on "assisted_selling_proposals" ("tenant_id", "status", "expires_at");`);
  }

}
