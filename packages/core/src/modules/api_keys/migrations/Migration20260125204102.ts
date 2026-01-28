import { Migration } from '@mikro-orm/migrations';

export class Migration20260125204102 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "api_keys" add column "session_secret_encrypted" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "api_keys" drop column "session_secret_encrypted";`);
  }

}
