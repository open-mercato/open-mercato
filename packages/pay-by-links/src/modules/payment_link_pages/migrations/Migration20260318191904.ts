import { Migration } from '@mikro-orm/migrations';

export class Migration20260318191904 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "payment_link_templates" add column "min_amount" numeric null, add column "max_amount" numeric null, add column "customer_fieldset_code" text null, add column "display_custom_fields" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "payment_link_templates" drop column "min_amount", drop column "max_amount", drop column "customer_fieldset_code", drop column "display_custom_fields";`);
  }

}
