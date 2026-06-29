import { Migration } from '@mikro-orm/migrations';

export class Migration20260531120000_communication_channels extends Migration {

  override up(): void | Promise<void> {
    // Enforce one thread token per (tenant, message_thread_id). Replaces the
    // earlier non-unique `channel_thread_tokens_thread_idx` so `getOrCreateThreadToken`
    // is idempotent under concurrency (insert-on-conflict). The new unique index
    // also serves the `WHERE tenant_id = ? AND message_thread_id = ?` lookup.
    this.addSql(`drop index if exists "channel_thread_tokens_thread_idx";`);
    this.addSql(`alter table "channel_thread_tokens" add constraint "channel_thread_tokens_thread_uq" unique ("tenant_id", "message_thread_id");`);
    // Enforce one channel per (tenant, user, provider, mailbox) so a reconnect
    // heals the existing row instead of inserting a duplicate. Partial: tenant-wide
    // (null user_id) and identifier-less channels are exempt.
    this.addSql(`create unique index "communication_channels_user_provider_external_uq" on "communication_channels" ("tenant_id", "user_id", "provider_key", "external_identifier") where "deleted_at" is null and "user_id" is not null and "external_identifier" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "communication_channels_user_provider_external_uq";`);
    this.addSql(`alter table "channel_thread_tokens" drop constraint if exists "channel_thread_tokens_thread_uq";`);
    this.addSql(`create index "channel_thread_tokens_thread_idx" on "channel_thread_tokens" ("message_thread_id", "tenant_id");`);
  }

}
