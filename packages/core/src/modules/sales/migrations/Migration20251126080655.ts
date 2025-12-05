import { Migration } from '@mikro-orm/migrations';

export class Migration20251126080655 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sales_document_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sales_document_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_document_tags_scope_idx" on "sales_document_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_tags" add constraint "sales_document_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "sales_document_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "document_id" uuid not null, "document_kind" text not null, "order_id" uuid null, "quote_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sales_document_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_document_tag_assignments_scope_idx" on "sales_document_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_unique" unique ("tag_id", "document_id", "document_kind");`);

    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "sales_document_tags" ("id") on update cascade;`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_document_tag_assignments" drop constraint "sales_document_tag_assignments_tag_id_foreign";`);
  }

}
