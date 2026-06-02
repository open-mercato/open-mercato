import { Migration } from '@mikro-orm/migrations';

/**
 * Drops the `client_state_encrypted` column from `communication_channels`.
 *
 * The column was added (Migration20260527230000) solely to store Microsoft
 * Graph's per-channel `clientState` anti-tampering nonce. The Microsoft 365 /
 * Outlook provider was removed (2026-06-02) before any release, so the column
 * is dead schema: no production path reads or writes it (Gmail authenticates
 * push via Pub/Sub JWT verification; IMAP has no webhook). Removing it also
 * drops the per-row decryption overhead its encryption-map entry added.
 */
export class Migration20260602120000_communication_channels extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "communication_channels" drop column if exists "client_state_encrypted";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "communication_channels" add column "client_state_encrypted" text null;`);
  }
}
