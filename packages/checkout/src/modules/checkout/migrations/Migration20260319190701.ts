import { Migration } from '@mikro-orm/migrations';

export class Migration20260319190701 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "checkout_links" add column "collect_customer_details" boolean not null default true;`);

    this.addSql(`alter table "checkout_link_templates" add column "collect_customer_details" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "checkout_links" drop column "collect_customer_details";`);

    this.addSql(`alter table "checkout_link_templates" drop column "collect_customer_details";`);
  }

}
