import { Migration } from '@mikro-orm/migrations';

export class Migration20260710002318_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "document_entity_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "customer_entity_id" uuid null, "customer_kind" varchar(16) null, "deal_id" uuid null, "product_id" uuid null, "catalog_offer_id" uuid null, "quote_id" uuid null, "sales_order_id" uuid null, "label_snapshot" text not null, "href_snapshot" varchar(1024) not null, "source" varchar(24) not null, "created_by_user_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_entity_links_sales_order_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "sales_order_id") where "sales_order_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "document_entity_links_quote_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "quote_id") where "quote_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "document_entity_links_catalog_offer_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "catalog_offer_id") where "catalog_offer_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "document_entity_links_product_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "product_id") where "product_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "document_entity_links_deal_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "deal_id") where "deal_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "document_entity_links_customer_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "customer_entity_id") where "customer_entity_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "document_entity_links_sales_order_active_uq" on "document_entity_links" ("document_id", "sales_order_id") where "sales_order_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "document_entity_links_quote_active_uq" on "document_entity_links" ("document_id", "quote_id") where "quote_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "document_entity_links_catalog_offer_active_uq" on "document_entity_links" ("document_id", "catalog_offer_id") where "catalog_offer_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "document_entity_links_product_active_uq" on "document_entity_links" ("document_id", "product_id") where "product_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "document_entity_links_deal_active_uq" on "document_entity_links" ("document_id", "deal_id") where "deal_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "document_entity_links_customer_active_uq" on "document_entity_links" ("document_id", "customer_entity_id") where "customer_entity_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "document_entity_links_document_lookup_idx" on "document_entity_links" ("tenant_id", "organization_id", "document_id", "deleted_at");`);

    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_customer_kind_chk" check ((("customer_entity_id" is not null and "customer_kind" in ('person', 'company')) or ("customer_entity_id" is null and "customer_kind" is null)));`);
    this.addSql(`alter table "document_entity_links" add constraint "document_entity_links_exactly_one_target_chk" check (num_nonnulls("customer_entity_id", "deal_id", "product_id", "catalog_offer_id", "quote_id", "sales_order_id") = 1);`);

    this.addSql(`alter table "document_templates" add "seed_key" varchar(128) null;`);
    this.addSql(`create unique index "document_templates_active_seed_key_uq" on "document_templates" ("tenant_id", "organization_id", "seed_key") where "seed_key" is not null and "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "document_templates_active_seed_key_uq";`);
    this.addSql(`alter table "document_templates" drop column "seed_key";`);

    this.addSql(`drop table if exists "document_entity_links" cascade;`);
  }

}
