import { Migration } from '@mikro-orm/migrations';

export class Migration20260922105444_customer_groups extends Migration {

  override name = 'Migration20260922105444';

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_group_terms" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid not null, "group_id" uuid not null, "price_kind_id" uuid null, "payment_terms_days" int null, "allow_purchase_on_account" boolean not null default false, "default_credit_limit" numeric(16,2) null, "credit_currency_code" text null, "approval_required_above" numeric(16,2) null, "min_order_value" numeric(16,2) null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "customer_group_terms_group_unique" on "customer_group_terms" ("group_id") where "deleted_at" is null;`);
    this.addSql(`create index "customer_group_terms_tenant_idx" on "customer_group_terms" ("tenant_id");`);
  }

}
