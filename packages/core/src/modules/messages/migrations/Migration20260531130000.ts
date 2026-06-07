import { Migration } from '@mikro-orm/migrations';

export class Migration20260531130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column if not exists "idempotency_key" text null;`);
    this.addSql(`create unique index if not exists "messages_idempotency_key_uq" on "messages" ("tenant_id", "idempotency_key") where "idempotency_key" is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "messages_idempotency_key_uq";`);
    this.addSql(`alter table "messages" drop column if exists "idempotency_key";`);
  }

}
