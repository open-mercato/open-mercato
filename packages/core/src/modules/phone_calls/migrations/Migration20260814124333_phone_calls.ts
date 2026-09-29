import { Migration } from '@mikro-orm/migrations';

export class Migration20260814124333_phone_calls extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "phone_call_participants" add constraint "phone_call_participants_phone_call_id_foreign" foreign key ("phone_call_id") references "phone_calls" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "phone_call_participants" drop constraint if exists "phone_call_participants_phone_call_id_foreign";`);
  }

}
