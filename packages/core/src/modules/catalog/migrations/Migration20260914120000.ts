import { Migration } from '@mikro-orm/migrations';

// Installs the two PostgreSQL extensions accent-insensitive product search needs
// (see Migration20260914120100, which creates the wrapper function and the index
// on top of them). They are separate migrations on purpose: `unaccent` must be a
// committed extension before a function body can pin its dictionary with
// `'public.unaccent'::regdictionary`, and the index is built CONCURRENTLY, which
// cannot run inside a transaction.
//
// `create extension` needs CREATE on the database, which the application role
// does not always hold on managed PostgreSQL. Failing here aborts the whole
// `yarn db:migrate` run — every later module's migrations included — so the bare
// `permission denied to create extension` is turned into a message that names
// what to grant. The check runs only when the extension is actually missing, so
// an instance where an operator pre-created them needs no extra privilege.
const ensureExtensionSql = (extension: string): string => `
  do $$
  begin
    if not exists (select 1 from pg_extension where extname = '${extension}') then
      begin
        execute 'create extension if not exists "${extension}" schema public';
      exception when insufficient_privilege then
        raise exception using
          errcode = 'insufficient_privilege',
          message = 'Open Mercato requires the PostgreSQL "${extension}" extension for accent-insensitive catalog search, and this role may not create it.',
          hint = 'Connect as a superuser (or allowlist the extension on managed PostgreSQL) and run: CREATE EXTENSION IF NOT EXISTS "${extension}" SCHEMA public; then re-run yarn db:migrate.';
      end;
    end if;
  end
  $$;
`;

export class Migration20260914120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(ensureExtensionSql('unaccent'));
    this.addSql(ensureExtensionSql('pg_trgm'));
  }

  override async down(): Promise<void> {
    // The extensions are deliberately left in place: other schemas may have come
    // to depend on them, and dropping an extension cascades to everything built
    // on it. Migration20260914120100 removes what this module actually owns.
  }

}
