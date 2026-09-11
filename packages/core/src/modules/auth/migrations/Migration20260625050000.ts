import { Migration } from '@mikro-orm/migrations';

// Add `kind` to `users` so an AI agent can be modeled as a first-class,
// non-interactive principal (`kind='agent'`) attributed identically to a human
// on every write (agent identity & on-behalf-of spec, Wave 4 Phase 1). The
// column is additive and backward-compatible per BACKWARD_COMPATIBILITY.md
// (DB schema is ADDITIVE-ONLY): NOT NULL with a server-side DEFAULT 'human', so
// every existing row backfills to 'human' immediately and no existing reader of
// `auth.User` breaks. The NOT NULL is safe online because the default fills the
// value for legacy rows during the ALTER.
export class Migration20260625050000 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "users" add column if not exists "kind" varchar(20) not null default 'human';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "users" drop column if exists "kind";`);
  }

}
