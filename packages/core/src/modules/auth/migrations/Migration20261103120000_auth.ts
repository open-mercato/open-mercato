import { Migration } from '@mikro-orm/migrations';

// Personal display timezone for the date/locale settings user override
// (`.ai/specs/2026-05-18-date-locale-settings.md`). Additive and nullable:
// null keeps every existing user on the organization default.
export class Migration20261103120000_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "users" add column if not exists "timezone" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "users" drop column if exists "timezone";`);
  }

}
