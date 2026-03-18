import { Migration } from '@mikro-orm/migrations';

export class Migration20260318185749 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "gateway_transactions" add column "document_type" text null, add column "document_id" text null;`);
    this.addSql(`create index "gateway_transactions_document_type_document_id_org_b1ff6_index" on "gateway_transactions" ("document_type", "document_id", "organization_id", "tenant_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "gateway_payment_links" ("id" uuid not null default gen_random_uuid(), "transaction_id" uuid null, "token" text not null, "provider_key" text not null, "title" text not null, "description" text null, "password_hash" text null, "status" text not null default 'active', "completed_at" timestamptz null, "link_mode" text not null default 'single', "template_id" uuid null, "use_count" int not null default 0, "max_uses" int null, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "gateway_payment_links_pkey" primary key ("id"));`);
    this.addSql(`create index "gateway_payment_links_organization_id_tenant_id_link_mode_index" on "gateway_payment_links" ("organization_id", "tenant_id", "link_mode");`);
    this.addSql(`create index "gateway_payment_links_organization_id_tenant_id_status_index" on "gateway_payment_links" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "gateway_payment_links_transaction_id_organization__0b731_index" on "gateway_payment_links" ("transaction_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "gateway_payment_links_token_index" on "gateway_payment_links" ("token");`);

    this.addSql(`create table "gateway_payment_link_transactions" ("id" uuid not null default gen_random_uuid(), "payment_link_id" uuid not null, "transaction_id" uuid not null, "customer_email" text not null, "customer_data" jsonb null, "created_at" timestamptz not null, constraint "gateway_payment_link_transactions_pkey" primary key ("id"));`);
    this.addSql(`create index "gateway_payment_link_transactions_transaction_id_index" on "gateway_payment_link_transactions" ("transaction_id");`);
    this.addSql(`create index "gateway_payment_link_transactions_payment_link_id_index" on "gateway_payment_link_transactions" ("payment_link_id");`);

    this.addSql(`drop index "gateway_transactions_document_type_document_id_org_b1ff6_index";`);
    this.addSql(`alter table "gateway_transactions" drop column "document_type", drop column "document_id";`);
  }

}
