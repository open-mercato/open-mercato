import { Migration } from '@mikro-orm/migrations';

export class Migration20260311154014 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "gateway_payment_links" ("id" uuid not null default gen_random_uuid(), "transaction_id" uuid not null, "token" text not null, "provider_key" text not null, "title" text not null, "description" text null, "password_hash" text null, "status" text not null default 'active', "completed_at" timestamptz null, "metadata" jsonb null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "gateway_payment_links_pkey" primary key ("id"));`);
    this.addSql(`create index "gateway_payment_links_organization_id_tenant_id_status_index" on "gateway_payment_links" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "gateway_payment_links_transaction_id_organization__0b731_index" on "gateway_payment_links" ("transaction_id", "organization_id", "tenant_id");`);
    this.addSql(`create unique index "gateway_payment_links_token_index" on "gateway_payment_links" ("token");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "gateway_payment_links";`);
  }

}
