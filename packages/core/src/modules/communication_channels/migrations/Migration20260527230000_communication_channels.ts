import { Migration } from '@mikro-orm/migrations';

/**
 * Spec C § Phase C1 — Provider push delivery.
 *
 * Adds a single nullable column `client_state_encrypted` to
 * `communication_channels` so Microsoft Graph's per-channel anti-tampering
 * nonce can be stored encrypted at rest (declared in
 * `packages/core/src/modules/communication_channels/encryption.ts`).
 *
 * Other providers (Gmail, IMAP) leave the column NULL.
 */
export class Migration20260527230000_communication_channels extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "communication_channels" add column "client_state_encrypted" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "communication_channels" drop column if exists "client_state_encrypted";`);
  }
}
