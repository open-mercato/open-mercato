import { Migration } from '@mikro-orm/migrations';

export class Migration20260318090716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "gateway_payment_link_transactions" ("id" uuid not null default gen_random_uuid(), "payment_link_id" uuid not null, "transaction_id" uuid not null, "customer_email" text not null, "customer_data" jsonb null, "created_at" timestamptz not null, constraint "gateway_payment_link_transactions_pkey" primary key ("id"));`);
    this.addSql(`create index "gateway_payment_link_transactions_transaction_id_index" on "gateway_payment_link_transactions" ("transaction_id");`);
    this.addSql(`create index "gateway_payment_link_transactions_payment_link_id_index" on "gateway_payment_link_transactions" ("payment_link_id");`);

    this.addSql(`alter table "gateway_payment_links" add column "link_mode" text not null default 'single', add column "template_id" uuid null, add column "use_count" int not null default 0, add column "max_uses" int null;`);
    this.addSql(`alter table "gateway_payment_links" alter column "transaction_id" drop default;`);
    this.addSql(`alter table "gateway_payment_links" alter column "transaction_id" type uuid using ("transaction_id"::text::uuid);`);
    this.addSql(`alter table "gateway_payment_links" alter column "transaction_id" drop not null;`);
    this.addSql(`create index "gateway_payment_links_organization_id_tenant_id_link_mode_index" on "gateway_payment_links" ("organization_id", "tenant_id", "link_mode");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "gateway_payment_links_organization_id_tenant_id_link_mode_index";`);
    this.addSql(`alter table "gateway_payment_links" drop column "link_mode", drop column "template_id", drop column "use_count", drop column "max_uses";`);

    this.addSql(`alter table "gateway_payment_links" alter column "transaction_id" drop default;`);
    this.addSql(`alter table "gateway_payment_links" alter column "transaction_id" type uuid using ("transaction_id"::text::uuid);`);
    this.addSql(`alter table "gateway_payment_links" alter column "transaction_id" set not null;`);
  }

}
