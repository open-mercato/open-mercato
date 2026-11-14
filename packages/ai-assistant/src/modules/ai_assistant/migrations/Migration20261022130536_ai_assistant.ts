import { Migration } from '@mikro-orm/migrations';

export class Migration20261022130536_ai_assistant extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "ai_pending_actions" add "channel" text not null default 'agent', add "api_key_id" uuid null, add "correlation_id" text null;`);
    this.addSql(`create index "ai_pending_actions_tenant_org_status_channel_created_idx" on "ai_pending_actions" ("tenant_id", "organization_id", "status", "channel", "created_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "ai_pending_actions_tenant_org_status_channel_created_idx";`);
    this.addSql(`alter table "ai_pending_actions" drop column "channel", drop column "api_key_id", drop column "correlation_id";`);
  }

}
