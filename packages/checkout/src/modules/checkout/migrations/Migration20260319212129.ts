import { Migration } from '@mikro-orm/migrations';

export class Migration20260319212129 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "checkout_links" add column "custom_fieldset_code" text null;`);

    this.addSql(`alter table "checkout_link_templates" add column "custom_fieldset_code" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "checkout_links" drop column "custom_fieldset_code";`);

    this.addSql(`alter table "checkout_link_templates" drop column "custom_fieldset_code";`);
  }

}
