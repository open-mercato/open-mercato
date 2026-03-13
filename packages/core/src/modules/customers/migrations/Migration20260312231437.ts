import { Migration } from '@mikro-orm/migrations';

export class Migration20260312231437 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_deal_emails" drop constraint "customer_deal_emails_message_unique";`);

    this.addSql(`alter table "customer_deal_emails" add constraint "customer_deal_emails_tenant_message_unique" unique ("tenant_id", "message_id");`);

    this.addSql(`create index "customer_deal_mentions_org_tenant_idx" on "customer_deal_mentions" ("organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_deal_emails" drop constraint "customer_deal_emails_tenant_message_unique";`);

    this.addSql(`alter table "customer_deal_emails" add constraint "customer_deal_emails_message_unique" unique ("message_id");`);

    this.addSql(`drop index "customer_deal_mentions_org_tenant_idx";`);
  }

}
