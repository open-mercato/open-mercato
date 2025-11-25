import { Migration } from '@mikro-orm/migrations';

export class Migration20251124155950 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sales_quotes" add column "channel_id" uuid null, add column "channel_ref_id" uuid null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_channel_ref_id_foreign" foreign key ("channel_ref_id") references "sales_channels" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_channel_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop column "channel_id", drop column "channel_ref_id";`);
  }

}
