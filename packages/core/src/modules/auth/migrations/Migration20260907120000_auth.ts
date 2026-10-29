import { Migration } from '@mikro-orm/migrations';

// Migration20251030150038 and MikroORM's naming strategy both call this constraint
// `user_sidebar_preferences_user_id_foreign` (`ON UPDATE CASCADE`, no delete rule).
// Migration20260427081815 creates `sidebar_variants_user_id_foreign` with neither rule.
// Postgres names an unnamed FK `<table>_user_id_fkey`. Some databases have no FK
// left on `user_sidebar_preferences.user_id` at all. Drop every known name and any
// other user_id -> users FK that is not already the target, then add the target
// only when that name is absent, so a second FK is never created.
function ensureUserIdForeignKey(table: 'user_sidebar_preferences' | 'sidebar_variants', rulesSql: string, alreadyDesiredSql: string): string {
  const constraint = `${table}_user_id_foreign`
  const legacy = `${table}_user_id_fkey`
  return `
    do $$
    declare
      fk record;
    begin
      for fk in
        select con.conname
        from pg_constraint con
        where con.conrelid = '${table}'::regclass
          and con.contype = 'f'
          and (
            con.conname in ('${constraint}', '${legacy}')
            or (
              con.confrelid = 'users'::regclass
              and pg_get_constraintdef(con.oid) ilike 'FOREIGN KEY (user_id)%'
            )
          )
          and not (
            con.conname = '${constraint}'
            and ${alreadyDesiredSql}
          )
      loop
        execute format('alter table %I drop constraint %I', '${table}', fk.conname);
      end loop;

      if not exists (
        select 1
        from pg_constraint
        where conrelid = '${table}'::regclass
          and conname = '${constraint}'
      ) then
        alter table "${table}"
          add constraint "${constraint}"
          foreign key ("user_id") references "users" ("id")${rulesSql};
      end if;
    end
    $$;
  `
}

const CASCADE_RULES = ' on update cascade on delete cascade'
const CASCADE_ALREADY = `pg_get_constraintdef(con.oid) ilike '%ON UPDATE CASCADE%' and pg_get_constraintdef(con.oid) ilike '%ON DELETE CASCADE%'`
const UPDATE_ONLY_ALREADY = `pg_get_constraintdef(con.oid) ilike '%ON UPDATE CASCADE%' and pg_get_constraintdef(con.oid) not ilike '%ON DELETE%'`
const NO_ACTION_ALREADY = `pg_get_constraintdef(con.oid) not ilike '%ON UPDATE%' and pg_get_constraintdef(con.oid) not ilike '%ON DELETE%'`

export class Migration20260907120000_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(ensureUserIdForeignKey('user_sidebar_preferences', CASCADE_RULES, CASCADE_ALREADY));
    this.addSql(ensureUserIdForeignKey('sidebar_variants', CASCADE_RULES, CASCADE_ALREADY));
  }

  override down(): void | Promise<void> {
    this.addSql(ensureUserIdForeignKey('user_sidebar_preferences', ' on update cascade', UPDATE_ONLY_ALREADY));
    this.addSql(ensureUserIdForeignKey('sidebar_variants', '', NO_ACTION_ALREADY));
  }

}
