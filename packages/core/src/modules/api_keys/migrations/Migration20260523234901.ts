import { Migration } from '@mikro-orm/migrations';

export class Migration20260523234901 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "api_keys" add column "opencode_session_id" text null;`);
    this.addSql(
      `create unique index "api_keys_opencode_session_id_uq" on "api_keys" ("opencode_session_id") where "opencode_session_id" is not null and "deleted_at" is null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "api_keys_opencode_session_id_uq";`);
    this.addSql(`alter table "api_keys" drop column "opencode_session_id";`);
  }

}
