import { Migration } from '@mikro-orm/migrations';

export class Migration20260411113503 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_users" add column "sessions_revoked_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_users" drop column "sessions_revoked_at";`);
  }

}
