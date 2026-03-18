import { Migration } from '@mikro-orm/migrations';

export class Migration20260318185706 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "payment_link_templates" add column "amount_type" text not null default 'fixed', add column "amount_options" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "payment_link_templates" drop column "amount_type", drop column "amount_options";`);
  }

}
