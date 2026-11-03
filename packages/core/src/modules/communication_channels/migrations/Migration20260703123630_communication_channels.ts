import { Migration } from '@mikro-orm/migrations';

export class Migration20260703123630_communication_channels extends Migration {

  override up(): void | Promise<void> {
    // Enforce one tenant-wide push channel per (tenant, provider). Push providers
    // (FCM/APNs/Expo) have no external_identifier and user_id IS NULL, so the
    // mailbox unique index (communication_channels_user_provider_external_uq) does
    // not cover them. This keeps an admin reconnect healing the single shared row
    // (createConnectedChannelRow) instead of inserting duplicates the push fan-out
    // would silently ignore. Only covers user_id IS NULL rows, so existing per-user
    // channels are unaffected.
    this.addSql(`create unique index "communication_channels_tenant_push_provider_uq" on "communication_channels" ("tenant_id", "provider_key") where "channel_type" = 'push' and "user_id" is null and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "communication_channels_tenant_push_provider_uq";`);
  }

}
