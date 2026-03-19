import { Migration } from '@mikro-orm/migrations';

export class Migration20260319050555 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter index "payment_links_transaction_id_organization__0b731_index" rename to "payment_links_transaction_id_organization_id_tenant_id_index";`);

    this.addSql(`alter table "payment_link_templates" add column "completed_content" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter index "payment_links_transaction_id_organization_id_tenant_id_index" rename to "payment_links_transaction_id_organization__0b731_index";`);

    this.addSql(`alter table "payment_link_templates" drop column "completed_content";`);
  }

}
