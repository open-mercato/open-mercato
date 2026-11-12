import { Migration } from '@mikro-orm/migrations';

export class Migration20261112192508_customer_groups extends Migration {

  override name = 'Migration20261112192508';

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_purchase_approval_email_deliveries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "approval_id" uuid not null, "kind" text not null, "recipient_key" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "customer_purchase_approval_email_deliveries_approval_idx" on "customer_purchase_approval_email_deliveries" ("approval_id");`);
    this.addSql(`alter table "customer_purchase_approval_email_deliveries" add constraint "customer_purchase_approval_email_deliveries_recipient_unique" unique ("tenant_id", "approval_id", "kind", "recipient_key");`);
  }

}
