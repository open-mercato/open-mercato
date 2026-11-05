import { Migration } from '@mikro-orm/migrations';

export class Migration20260116225251 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "api_keys" add column "session_token" text null, add column "session_user_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "api_keys" drop column "session_token", drop column "session_user_id";`);
  }

}
