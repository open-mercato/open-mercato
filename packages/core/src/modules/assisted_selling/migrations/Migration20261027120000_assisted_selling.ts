import { Migration } from '@mikro-orm/migrations';

export class Migration20261027120000_assisted_selling extends Migration {

  override name = 'Migration20261027120000';

  override up(): void | Promise<void> {
    this.addSql(`create table "assisted_selling_store_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "store_id" uuid not null, "mode" text not null default 'off', "ai_proposals_require_rep_approval" boolean not null default false, "proposal_ttl_seconds" int not null default 259200, "max_proposal_lines" int not null default 50, "ai_max_proposals_per_thread_per_hour" int not null default 4, "ai_max_turns_per_thread_per_hour" int not null default 20, "conversation_retention_days" int not null default 365, "idle_close_days" int not null default 30, "ai_agent_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "assisted_selling_store_settings" add constraint "assisted_selling_store_settings_scope_unique" unique ("tenant_id", "organization_id", "store_id");`);
  }

}
