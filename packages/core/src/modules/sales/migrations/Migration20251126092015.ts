import { Migration } from '@mikro-orm/migrations';

export class Migration20251126092015 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sales_document_addresses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "document_kind" text not null, "address_id" uuid not null, "address_snapshot" jsonb null, "order_id" uuid null, "quote_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sales_document_addresses_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_document_addresses_scope_idx" on "sales_document_addresses" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_unique" unique ("document_id", "document_kind", "address_id");`);

    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);
  }

}
