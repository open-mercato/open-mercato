import { Migration } from '@mikro-orm/migrations';

export class Migration20261010185225 extends Migration {

  override async up(): Promise<void> {
    // #2254: session_token stored the AI-chat session bearer credential in the clear and was
    // looked up by exact equality. Replace it with a SHA-256 hash column, mirroring the
    // customer_accounts session-token pattern. No backfill: session tokens default to a 30
    // minute TTL (MAX_CUSTOMER_SESSIONS_PER_USER-style env override aside, see
    // apiKeyService.createSessionApiKey), so by the time this migration runs in any real
    // deployment every existing session_token value is already expired. Any mid-flight AI
    // chat session loses its MCP session binding across this deploy and the chat UI mints a
    // fresh one automatically (ai_assistant session-key route) — a one-time, low-cost reset
    // for a credential that was never meant to outlive the chat tab anyway.
    this.addSql(`alter table "api_keys" add column "session_token_hash" text null;`);
    this.addSql(
      `create unique index "api_keys_session_token_hash_uq" on "api_keys" ("session_token_hash") where "session_token_hash" is not null and "deleted_at" is null;`
    );
    this.addSql(`alter table "api_keys" drop column "session_token";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "api_keys" add column "session_token" text null;`);
    this.addSql(`drop index "api_keys_session_token_hash_uq";`);
    this.addSql(`alter table "api_keys" drop column "session_token_hash";`);
  }

}
