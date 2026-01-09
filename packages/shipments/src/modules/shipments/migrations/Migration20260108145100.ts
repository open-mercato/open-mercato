import { Migration } from '@mikro-orm/migrations';

export class Migration20260108145100 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from information_schema.columns
          where table_name = 'users' and column_name = 'email_hash'
        ) then
          alter table "users" add column "email_hash" text null;
        end if;
      end $$;
    `);
    this.addSql(`
      create index if not exists "users_email_hash_idx" on "users" ("email_hash");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "users_email_hash_idx";`);
    this.addSql(`alter table "users" drop column "email_hash";`);
  }

}
