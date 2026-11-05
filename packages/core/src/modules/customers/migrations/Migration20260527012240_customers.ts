import { Migration } from '@mikro-orm/migrations';

export class Migration20260527012240_customers extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "customer_interactions" add "external_message_id" uuid null, add "channel_provider_key" text null;`);
    // Backfill: pre-existing email-log interactions predate per-email visibility
    // and have null visibility. Mark them 'shared' so they keep their prior
    // visible-to-all behavior once the visibility filter is enabled.
    this.addSql(`update "customer_interactions" set "visibility" = 'shared' where "interaction_type" = 'email' and "visibility" is null and "external_message_id" is null;`);
    this.addSql(`create index "customer_interactions_external_msg_idx" on "customer_interactions" ("external_message_id") where "external_message_id" is not null;`);
    this.addSql(`create unique index "customer_interactions_email_dedupe_uq" on "customer_interactions" ("entity_id", "external_message_id") where "external_message_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "customer_interactions_email_visibility_idx" on "customer_interactions" ("entity_id", "interaction_type", "visibility", "author_user_id") where "interaction_type" = 'email' and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "customer_interactions_email_visibility_idx";`);
    this.addSql(`drop index if exists "customer_interactions_email_dedupe_uq";`);
    this.addSql(`drop index if exists "customer_interactions_external_msg_idx";`);
    this.addSql(`alter table "customer_interactions" drop column "external_message_id", drop column "channel_provider_key";`);
  }

}
