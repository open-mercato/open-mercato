import { Migration } from '@mikro-orm/migrations';

export class Migration20261012202110_api_keys extends Migration {

  override name = 'Migration20261012202110';

  override async up(): Promise<void> {
    this.addSql(`alter table "api_keys" add "session_token_hash" text null;`);

    // Backfill before switching any lookup to the hash column (#2254). AI-chat session keys
    // carry a 2-hour TTL and mint once per conversation (ai_assistant chat route, `!sessionId`
    // branch) — a session already in flight when this deploys must keep resolving, or the
    // conversation silently loses its MCP tool-call auth with no automatic re-mint. `sha256()`
    // is a PostgreSQL 13+ built-in (no pgcrypto dependency) and matches
    // `hashSessionToken`'s `createHash('sha256').update(token).digest('hex')` byte for byte.
    this.addSql(`
      update "api_keys"
      set "session_token_hash" = encode(sha256("session_token"::bytea), 'hex')
      where "session_token" is not null and "session_token_hash" is null;
    `);

    // Legacy rows embedded the raw token in `name` (`__session_<token>__`, for operator
    // visibility in an admin listing) — the same credential leaking a second way. Replace it
    // with a hash-derived, non-secret label before the token itself is cleared below.
    this.addSql(`
      update "api_keys"
      set "name" = '__session_' || substr("session_token_hash", 1, 12) || '__'
      where "session_token" is not null and "name" = '__session_' || "session_token" || '__';
    `);

    // Stop storing the plaintext bearer credential. The column is kept, not dropped, per the
    // "renamed/removed DB column" rule in `.ai/review-checklist.md` (keep old column, add new
    // one, backfill, deprecate old) — see `ApiKey.sessionToken`'s `@deprecated` doc comment for
    // the removal criteria for a later migration.
    this.addSql(`update "api_keys" set "session_token" = null where "session_token" is not null;`);

    this.addSql(`create unique index "api_keys_session_token_hash_uq" on "api_keys" ("session_token_hash") where "session_token_hash" is not null and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    // Schema-only reversal. The plaintext `session_token` values cleared above cannot be
    // restored — that data loss is the point of the migration, not an oversight.
    this.addSql(`drop index "api_keys_session_token_hash_uq";`);
    this.addSql(`alter table "api_keys" drop column "session_token_hash";`);
  }

}
