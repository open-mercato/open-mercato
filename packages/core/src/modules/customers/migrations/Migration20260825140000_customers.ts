import { Migration } from '@mikro-orm/migrations';

export class Migration20260825140000_customers extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_interactions" add column "channel_id" uuid null;`);

    // Backfill the denormalized channel id for pre-existing email rows.
    //
    // This is the only available chain — `message_channel_links` carries no
    // channel id of its own:
    //   customer_interactions.external_message_id -> message_channel_links.id
    //   message_channel_links.external_conversation_id -> external_conversations.id
    //   external_conversations.channel_id -> communication_channels.id
    //
    // Rows whose chain cannot be resolved keep channel_id NULL, which every read
    // predicate treats as "not shared" (fail closed). Scoped by tenant on both
    // joins so a backfill can never attribute an interaction to another tenant's
    // channel.
    this.addSql(`
      update "customer_interactions" ci
      set "channel_id" = ec."channel_id"
      from "message_channel_links" mcl
      join "external_conversations" ec
        on ec."id" = mcl."external_conversation_id"
       and ec."tenant_id" = mcl."tenant_id"
      where ci."external_message_id" = mcl."id"
        and ci."tenant_id" = mcl."tenant_id"
        and ci."interaction_type" = 'email'
        and ci."channel_id" is null;
    `);

    this.addSql(`create index "customer_interactions_email_channel_idx" on "customer_interactions" ("channel_id", "entity_id") where "interaction_type" = 'email' and "channel_id" is not null and "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "customer_interactions_email_channel_idx";`);
    this.addSql(`alter table "customer_interactions" drop column if exists "channel_id";`);
  }

}
