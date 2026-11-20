import { Migration } from '@mikro-orm/migrations';

export class Migration20261121120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "messages" add column if not exists "sender_delivery_options" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "messages" drop column if exists "sender_delivery_options";`);
  }

}
