import { Migration } from '@mikro-orm/migrations'

export class Migration20260717000000_documents extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`alter table "documents" add "archived_at" timestamptz null;`)

    this.addSql(`alter table "document_entity_links" add "linked_document_id" uuid null;`)
    this.addSql(`alter table "document_entity_links" drop constraint if exists "document_entity_links_exactly_one_target_chk";`)
    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_exactly_one_target_chk" check (num_nonnulls("customer_entity_id", "deal_id", "product_id", "catalog_offer_id", "quote_id", "sales_order_id", "linked_document_id") = 1);`)
    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_no_self_link_chk" check ("document_id" <> "linked_document_id");`)
    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_linked_document_id_foreign" foreign key ("linked_document_id") references "documents" ("id") on delete cascade;`)
    this.addSql(`create unique index "document_entity_links_linked_document_active_uq" on "document_entity_links" ("document_id", "linked_document_id") where "linked_document_id" is not null and "deleted_at" is null;`)
    this.addSql(`create index "document_entity_links_linked_document_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "linked_document_id") where "linked_document_id" is not null and "deleted_at" is null;`)

    this.addSql(`create table "document_favorites" ("id" uuid not null default gen_random_uuid(), "document_id" uuid not null, "user_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`)
    this.addSql(`create unique index "document_favorites_active_user_uq" on "document_favorites" ("document_id", "user_id") where "deleted_at" is null;`)
    this.addSql(`create index "document_favorites_user_lookup_idx" on "document_favorites" ("tenant_id", "organization_id", "user_id");`)
    this.addSql(`alter table "document_favorites" add constraint "document_favorites_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`)

    this.addSql(`create table "document_watchers" ("id" uuid not null default gen_random_uuid(), "document_id" uuid not null, "user_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`)
    this.addSql(`create unique index "document_watchers_active_user_uq" on "document_watchers" ("document_id", "user_id") where "deleted_at" is null;`)
    this.addSql(`create index "document_watchers_user_lookup_idx" on "document_watchers" ("tenant_id", "organization_id", "user_id");`)
    this.addSql(`alter table "document_watchers" add constraint "document_watchers_document_id_foreign" foreign key ("document_id") references "documents" ("id") on delete cascade;`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "document_watchers" cascade;`)
    this.addSql(`drop table if exists "document_favorites" cascade;`)

    this.addSql(`drop index if exists "document_entity_links_linked_document_reverse_idx";`)
    this.addSql(`drop index if exists "document_entity_links_linked_document_active_uq";`)
    this.addSql(`alter table "document_entity_links" drop constraint if exists "document_entity_links_linked_document_id_foreign";`)
    this.addSql(`alter table "document_entity_links" drop constraint if exists "document_entity_links_no_self_link_chk";`)
    this.addSql(`alter table "document_entity_links" drop constraint if exists "document_entity_links_exactly_one_target_chk";`)
    this.addSql(`alter table "document_entity_links" drop column "linked_document_id";`)
    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_exactly_one_target_chk" check (num_nonnulls("customer_entity_id", "deal_id", "product_id", "catalog_offer_id", "quote_id", "sales_order_id") = 1);`)

    this.addSql(`alter table "documents" drop column "archived_at";`)
  }
}
