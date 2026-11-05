import { Migration } from '@mikro-orm/migrations';

export class Migration20260319190203 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "checkout_links" add column "send_success_email" boolean not null default true, add column "send_error_email" boolean not null default true, add column "send_start_email" boolean not null default true;`);

    this.addSql(`alter table "checkout_link_templates" add column "send_success_email" boolean not null default true, add column "send_error_email" boolean not null default true, add column "send_start_email" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "checkout_links" drop column "send_success_email", drop column "send_error_email", drop column "send_start_email";`);

    this.addSql(`alter table "checkout_link_templates" drop column "send_success_email", drop column "send_error_email", drop column "send_start_email";`);
  }

}
