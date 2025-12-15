import { Migration } from '@mikro-orm/migrations';

export class Migration20251202191547 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "rule_execution_logs" drop constraint "rule_execution_logs_rule_id_foreign";`);

    this.addSql(`alter table "rule_set_members" drop constraint "rule_set_members_rule_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_price_kind_id_foreign";`);

    this.addSql(`alter table "catalog_product_category_assignments" drop constraint "catalog_product_category_assignments_category_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_offer_id_foreign";`);

    this.addSql(`alter table "catalog_products" drop constraint "catalog_products_option_schema_id_foreign";`);

    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint "catalog_product_tag_assignments_tag_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_option_values" drop constraint "catalog_product_variant_option_values_variant_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_variant_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_child_variant_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_relations" drop constraint "catalog_product_variant_relations_parent_variant_id_foreign";`);

    this.addSql(`alter table "catalog_product_category_assignments" drop constraint "catalog_product_category_assignments_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_offers" drop constraint "catalog_product_offers_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_options" drop constraint "catalog_product_options_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_relations" drop constraint "catalog_product_relations_child_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_relations" drop constraint "catalog_product_relations_parent_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_tag_assignments" drop constraint "catalog_product_tag_assignments_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variant_prices" drop constraint "catalog_product_variant_prices_product_id_foreign";`);

    this.addSql(`alter table "catalog_product_variants" drop constraint "catalog_product_variants_product_id_foreign";`);

    this.addSql(`alter table "customer_activities" drop constraint "customer_activities_deal_id_foreign";`);

    this.addSql(`alter table "customer_comments" drop constraint "customer_comments_deal_id_foreign";`);

    this.addSql(`alter table "customer_deal_companies" drop constraint "customer_deal_companies_deal_id_foreign";`);

    this.addSql(`alter table "customer_deal_people" drop constraint "customer_deal_people_deal_id_foreign";`);

    this.addSql(`alter table "customer_activities" drop constraint "customer_activities_entity_id_foreign";`);

    this.addSql(`alter table "customer_addresses" drop constraint "customer_addresses_entity_id_foreign";`);

    this.addSql(`alter table "customer_comments" drop constraint "customer_comments_entity_id_foreign";`);

    this.addSql(`alter table "customer_companies" drop constraint "customer_companies_entity_id_foreign";`);

    this.addSql(`alter table "customer_deal_companies" drop constraint "customer_deal_companies_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_deal_people" drop constraint "customer_deal_people_person_entity_id_foreign";`);

    this.addSql(`alter table "customer_people" drop constraint "customer_people_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_people" drop constraint "customer_people_entity_id_foreign";`);

    this.addSql(`alter table "customer_tag_assignments" drop constraint "customer_tag_assignments_entity_id_foreign";`);

    this.addSql(`alter table "customer_todo_links" drop constraint "customer_todo_links_entity_id_foreign";`);

    this.addSql(`alter table "customer_tag_assignments" drop constraint "customer_tag_assignments_tag_id_foreign";`);

    this.addSql(`alter table "dictionary_entries" drop constraint "dictionary_entries_dictionary_id_foreign";`);

    this.addSql(`alter table "role_acls" drop constraint "role_acls_role_id_foreign";`);

    this.addSql(`alter table "role_sidebar_preferences" drop constraint "role_sidebar_preferences_role_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_role_id_foreign";`);

    this.addSql(`alter table "rule_set_members" drop constraint "rule_set_members_rule_set_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_channel_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_channel_ref_id_foreign";`);

    this.addSql(`alter table "sales_credit_memo_lines" drop constraint "sales_credit_memo_lines_credit_memo_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_delivery_window_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_delivery_window_ref_id_foreign";`);

    this.addSql(`alter table "sales_credit_memos" drop constraint "sales_credit_memos_invoice_id_foreign";`);

    this.addSql(`alter table "sales_invoice_lines" drop constraint "sales_invoice_lines_invoice_id_foreign";`);

    this.addSql(`alter table "sales_payment_allocations" drop constraint "sales_payment_allocations_invoice_id_foreign";`);

    this.addSql(`alter table "sales_credit_memo_lines" drop constraint "sales_credit_memo_lines_order_line_id_foreign";`);

    this.addSql(`alter table "sales_invoice_lines" drop constraint "sales_invoice_lines_order_line_id_foreign";`);

    this.addSql(`alter table "sales_order_adjustments" drop constraint "sales_order_adjustments_order_line_id_foreign";`);

    this.addSql(`alter table "sales_shipment_items" drop constraint "sales_shipment_items_order_line_id_foreign";`);

    this.addSql(`alter table "sales_credit_memos" drop constraint "sales_credit_memos_order_id_foreign";`);

    this.addSql(`alter table "sales_invoices" drop constraint "sales_invoices_order_id_foreign";`);

    this.addSql(`alter table "sales_notes" drop constraint "sales_notes_order_id_foreign";`);

    this.addSql(`alter table "sales_order_adjustments" drop constraint "sales_order_adjustments_order_id_foreign";`);

    this.addSql(`alter table "sales_order_lines" drop constraint "sales_order_lines_order_id_foreign";`);

    this.addSql(`alter table "sales_payment_allocations" drop constraint "sales_payment_allocations_order_id_foreign";`);

    this.addSql(`alter table "sales_payments" drop constraint "sales_payments_order_id_foreign";`);

    this.addSql(`alter table "sales_shipments" drop constraint "sales_shipments_order_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_payment_method_ref_id_foreign";`);

    this.addSql(`alter table "sales_payments" drop constraint "sales_payments_payment_method_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_payment_method_ref_id_foreign";`);

    this.addSql(`alter table "sales_payment_allocations" drop constraint "sales_payment_allocations_payment_id_foreign";`);

    this.addSql(`alter table "sales_quote_adjustments" drop constraint "sales_quote_adjustments_quote_line_id_foreign";`);

    this.addSql(`alter table "sales_notes" drop constraint "sales_notes_quote_id_foreign";`);

    this.addSql(`alter table "sales_quote_adjustments" drop constraint "sales_quote_adjustments_quote_id_foreign";`);

    this.addSql(`alter table "sales_quote_lines" drop constraint "sales_quote_lines_quote_id_foreign";`);

    this.addSql(`alter table "sales_shipment_items" drop constraint "sales_shipment_items_shipment_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_shipping_method_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_shipping_method_ref_id_foreign";`);

    this.addSql(`alter table "organizations" drop constraint "organizations_tenant_id_foreign";`);

    this.addSql(`alter table "password_resets" drop constraint "password_resets_user_id_foreign";`);

    this.addSql(`alter table "sessions" drop constraint "sessions_user_id_foreign";`);

    this.addSql(`alter table "user_acls" drop constraint "user_acls_user_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_user_id_foreign";`);

    this.addSql(`alter table "user_sidebar_preferences" drop constraint "user_sidebar_preferences_user_id_foreign";`);

    this.addSql(`create table "shipments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "internal_reference" varchar(255) null, "client" varchar(255) null, "order" varchar(255) null, "booking_number" varchar(255) null, "container_number" varchar(255) null, "origin_location" varchar(255) null, "destination_location" varchar(255) null, "etd" timestamptz null, "atd" timestamptz null, "eta" timestamptz null, "ata" timestamptz null, "status" text check ("status" in ('BOOKED', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED')) not null default 'BOOKED', "container_type" text check ("container_type" in ('20FT', '40FT', '40FT_HC', '45FT')) not null, "carrier_name" varchar(255) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "shipments_pkey" primary key ("id"));`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "access_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "actor_user_id" uuid null, "resource_kind" text not null, "resource_id" text not null, "access_type" text not null, "fields_json" jsonb null, "context_json" jsonb null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "access_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "access_logs_actor_idx" on "access_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "access_logs_tenant_idx" on "access_logs" ("tenant_id", "created_at");`);

    this.addSql(`create table "action_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "actor_user_id" uuid null, "command_id" text not null, "action_label" text null, "resource_kind" text null, "resource_id" text null, "execution_state" text not null default 'done', "undo_token" text null, "command_payload" jsonb null, "snapshot_before" jsonb null, "snapshot_after" jsonb null, "changes_json" jsonb null, "context_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "action_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "action_logs_actor_idx" on "action_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "action_logs_tenant_idx" on "action_logs" ("tenant_id", "created_at");`);

    this.addSql(`create table "api_keys" ("id" uuid not null default gen_random_uuid(), "name" text not null, "description" text null, "tenant_id" uuid null, "organization_id" uuid null, "key_hash" text not null, "key_prefix" text not null, "roles_json" jsonb null, "created_by" uuid null, "last_used_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "api_keys_pkey" primary key ("id"));`);
    this.addSql(`alter table "api_keys" add constraint "api_keys_key_prefix_unique" unique ("key_prefix");`);

    this.addSql(`create table "attachment_partitions" ("id" uuid not null default gen_random_uuid(), "code" text not null, "title" text not null, "description" text null, "storage_driver" text not null default 'local', "config_json" jsonb null, "is_public" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "attachment_partitions_pkey" primary key ("id"));`);
    this.addSql(`alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");`);

    this.addSql(`create table "attachments" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "file_name" text not null, "mime_type" text not null, "file_size" int4 not null, "url" text not null, "created_at" timestamptz(6) not null, "partition_code" text not null, "storage_driver" text not null default 'local', "storage_path" text not null, "storage_metadata" jsonb null, constraint "attachments_pkey" primary key ("id"));`);
    this.addSql(`create index "attachments_entity_record_idx" on "attachments" ("record_id");`);
    this.addSql(`create index "attachments_partition_code_idx" on "attachments" ("partition_code");`);

    this.addSql(`create table "business_rules" ("id" uuid not null default gen_random_uuid(), "rule_id" varchar(50) not null, "rule_name" varchar(200) not null, "description" text null, "rule_type" varchar(20) not null, "rule_category" varchar(50) null, "entity_type" varchar(50) not null, "event_type" varchar(50) null, "condition_expression" jsonb not null, "success_actions" jsonb null, "failure_actions" jsonb null, "enabled" bool not null default true, "priority" int4 not null default 100, "version" int4 not null default 1, "effective_from" timestamptz(6) null, "effective_to" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(50) null, "updated_by" varchar(50) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "business_rules_pkey" primary key ("id"));`);
    this.addSql(`create index "business_rules_entity_event_idx" on "business_rules" ("entity_type", "event_type", "enabled");`);
    this.addSql(`alter table "business_rules" add constraint "business_rules_rule_id_tenant_id_unique" unique ("rule_id", "tenant_id");`);
    this.addSql(`create index "business_rules_tenant_org_idx" on "business_rules" ("tenant_id", "organization_id");`);
    this.addSql(`create index "business_rules_type_enabled_idx" on "business_rules" ("rule_type", "enabled", "priority");`);

    this.addSql(`create table "catalog_price_kinds" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid not null, "code" text not null, "title" text not null, "display_mode" text not null default 'excluding-tax', "currency_code" text null, "is_promotion" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "catalog_price_kinds_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_price_kinds" add constraint "catalog_price_kinds_code_tenant_unique" unique ("tenant_id", "code");`);
    this.addSql(`create index "catalog_price_kinds_tenant_idx" on "catalog_price_kinds" ("tenant_id");`);

    this.addSql(`create table "catalog_product_categories" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "slug" text null, "description" text null, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int4 not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "catalog_product_categories_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_categories_scope_idx" on "catalog_product_categories" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_categories" add constraint "catalog_product_categories_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_category_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "category_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_category_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_category_assignments_scope_idx" on "catalog_product_category_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_unique" unique ("product_id", "category_id");`);

    this.addSql(`create table "catalog_product_offers" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "channel_id" uuid not null, "title" text not null, "description" text null, "localized_content" jsonb null, "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_media_id" uuid null, "default_media_url" text null, constraint "catalog_product_offers_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_channel_unique" unique ("product_id", "organization_id", "tenant_id", "channel_id");`);
    this.addSql(`create index "catalog_product_offers_scope_idx" on "catalog_product_offers" ("organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_option_schemas" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "schema" jsonb not null, "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "catalog_product_option_schemas_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_product_option_schemas" add constraint "catalog_product_option_schemas_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "catalog_product_option_schemas_scope_idx" on "catalog_product_option_schemas" ("organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_option_values" ("id" uuid not null default gen_random_uuid(), "option_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int4 not null default 0, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_option_values_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_product_option_values" add constraint "catalog_product_option_values_code_unique" unique ("organization_id", "tenant_id", "option_id", "code");`);
    this.addSql(`create index "catalog_product_option_values_scope_idx" on "catalog_product_option_values" ("option_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_options" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "label" text not null, "description" text null, "position" int4 not null default 0, "is_required" bool not null default false, "is_multiple" bool not null default false, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "input_type" text not null default 'select', "input_config" jsonb null, constraint "catalog_product_options_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_options_scope_idx" on "catalog_product_options" ("product_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_relations" ("id" uuid not null default gen_random_uuid(), "parent_product_id" uuid not null, "child_product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" bool not null default false, "min_quantity" int4 null, "max_quantity" int4 null, "position" int4 not null default 0, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_relations_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_relations_child_idx" on "catalog_product_relations" ("child_product_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_relations_parent_idx" on "catalog_product_relations" ("parent_product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_unique" unique ("parent_product_id", "child_product_id", "relation_type");`);

    this.addSql(`create table "catalog_product_tag_assignments" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "tag_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_tag_assignments_scope_idx" on "catalog_product_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_unique" unique ("product_id", "tag_id");`);

    this.addSql(`create table "catalog_product_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "label" text not null, "slug" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_tags_scope_idx" on "catalog_product_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_tags" add constraint "catalog_product_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "catalog_product_variant_option_values" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid not null, "option_value_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_variant_option_values_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_unique" unique ("variant_id", "option_value_id");`);

    this.addSql(`create table "catalog_product_variant_prices" ("id" uuid not null default gen_random_uuid(), "variant_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "currency_code" text not null, "kind" text not null default 'regular', "min_quantity" int4 not null default 1, "max_quantity" int4 null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "tax_rate" numeric(7,4) null, "metadata" jsonb null, "starts_at" timestamptz(6) null, "ends_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "product_id" uuid null, "offer_id" uuid null, "channel_id" uuid null, "user_id" uuid null, "user_group_id" uuid null, "customer_id" uuid null, "customer_group_id" uuid null, "price_kind_id" uuid not null, "tax_amount" numeric(16,4) null, constraint "catalog_product_variant_prices_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variant_prices_product_scope_idx" on "catalog_product_variant_prices" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_unique" unique ("variant_id", "organization_id", "tenant_id", "currency_code", "price_kind_id", "min_quantity");`);
    this.addSql(`create index "catalog_product_variant_prices_variant_scope_idx" on "catalog_product_variant_prices" ("variant_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "catalog_product_variant_relations" ("id" uuid not null default gen_random_uuid(), "parent_variant_id" uuid not null, "child_variant_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "relation_type" text not null default 'grouped', "is_required" bool not null default false, "min_quantity" int4 null, "max_quantity" int4 null, "position" int4 not null default 0, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "catalog_product_variant_relations_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variant_relations_child_idx" on "catalog_product_variant_relations" ("child_variant_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "catalog_product_variant_relations_parent_idx" on "catalog_product_variant_relations" ("parent_variant_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_unique" unique ("parent_variant_id", "child_variant_id", "relation_type");`);

    this.addSql(`create table "catalog_product_variants" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "sku" text null, "barcode" text null, "status_entry_id" text null, "is_default" bool not null default false, "is_active" bool not null default true, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "custom_fieldset_code" text null, "default_media_id" uuid null, "default_media_url" text null, "option_values" jsonb null, constraint "catalog_product_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variants_scope_idx" on "catalog_product_variants" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_sku_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "catalog_products" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "subtitle" text null, "status_entry_id" uuid null, "primary_currency_code" text null, "default_unit" text null, "metadata" jsonb null, "is_configurable" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "product_type" text not null default 'simple', "sku" text null, "handle" text null, "option_schema_id" uuid null, "custom_fieldset_code" text null, "default_media_id" uuid null, "default_media_url" text null, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, constraint "catalog_products_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_handle_scope_unique" unique ("organization_id", "tenant_id", "handle");`);
    this.addSql(`create index "catalog_products_org_tenant_idx" on "catalog_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_sku_scope_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "custom_entities" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "label" text not null, "description" text null, "label_field" text null, "default_editor" text null, "show_in_sidebar" bool not null default false, "organization_id" uuid null, "tenant_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_entities_pkey" primary key ("id"));`);
    this.addSql(`create index "custom_entities_unique_idx" on "custom_entities" ("entity_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "custom_entities_storage" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "doc" jsonb not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_entities_storage_pkey" primary key ("id"));`);
    this.addSql(`create index "custom_entities_storage_unique_idx" on "custom_entities_storage" ("entity_type", "entity_id", "organization_id");`);

    this.addSql(`create table "custom_field_defs" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "key" text not null, "kind" text not null, "config_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_field_defs_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_defs_active_entity_global_idx" on "custom_field_defs" ("entity_id");`);
    this.addSql(`create index "cf_defs_active_entity_key_scope_idx" on "custom_field_defs" ("entity_id", "key", "tenant_id", "organization_id");`);
    this.addSql(`create index "cf_defs_active_entity_org_idx" on "custom_field_defs" ("entity_id", "organization_id");`);
    this.addSql(`create index "cf_defs_active_entity_tenant_idx" on "custom_field_defs" ("entity_id", "tenant_id");`);
    this.addSql(`create index "cf_defs_active_entity_tenant_org_idx" on "custom_field_defs" ("entity_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "cf_defs_entity_key_idx" on "custom_field_defs" ("key");`);

    this.addSql(`create table "custom_field_entity_configs" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "config_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_field_entity_configs_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_entity_cfgs_entity_org_idx" on "custom_field_entity_configs" ("entity_id", "organization_id");`);
    this.addSql(`create index "cf_entity_cfgs_entity_scope_idx" on "custom_field_entity_configs" ("entity_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "cf_entity_cfgs_entity_tenant_idx" on "custom_field_entity_configs" ("entity_id", "tenant_id");`);

    this.addSql(`create table "custom_field_values" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field_key" text not null, "value_text" text null, "value_multiline" text null, "value_int" int4 null, "value_float" float4 null, "value_bool" bool null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "custom_field_values_pkey" primary key ("id"));`);
    this.addSql(`create index "cf_values_entity_record_field_idx" on "custom_field_values" ("field_key");`);
    this.addSql(`create index "cf_values_entity_record_tenant_idx" on "custom_field_values" ("entity_id", "record_id", "tenant_id");`);

    this.addSql(`create table "customer_activities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz(6) null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, "deal_id" uuid null, constraint "customer_activities_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_activities_entity_idx" on "customer_activities" ("entity_id");`);
    this.addSql(`create index "customer_activities_entity_occurred_created_idx" on "customer_activities" ("entity_id", "occurred_at", "created_at");`);
    this.addSql(`create index "customer_activities_org_tenant_idx" on "customer_activities" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_addresses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "purpose" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" float4 null, "longitude" float4 null, "is_primary" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, "company_name" text null, constraint "customer_addresses_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_addresses_entity_idx" on "customer_addresses" ("entity_id");`);

    this.addSql(`create table "customer_comments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "entity_id" uuid not null, "deal_id" uuid null, constraint "customer_comments_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_comments_entity_created_idx" on "customer_comments" ("entity_id", "created_at");`);
    this.addSql(`create index "customer_comments_entity_idx" on "customer_comments" ("entity_id");`);

    this.addSql(`create table "customer_companies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "legal_name" text null, "brand_name" text null, "domain" text null, "website_url" text null, "industry" text null, "size_bucket" text null, "annual_revenue" numeric(16,2) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, constraint "customer_companies_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_companies" add constraint "customer_companies_entity_id_unique" unique ("entity_id");`);
    this.addSql(`create index "customer_companies_org_tenant_idx" on "customer_companies" ("organization_id", "tenant_id");`);
    this.addSql(`create index "idx_customer_companies_entity_id" on "customer_companies" ("entity_id");`);

    this.addSql(`create table "customer_deal_companies" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(6) not null, "deal_id" uuid not null, "company_entity_id" uuid not null, constraint "customer_deal_companies_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_companies_company_idx" on "customer_deal_companies" ("company_entity_id");`);
    this.addSql(`create index "customer_deal_companies_deal_idx" on "customer_deal_companies" ("deal_id");`);
    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_unique" unique ("deal_id", "company_entity_id");`);

    this.addSql(`create table "customer_deal_people" ("id" uuid not null default gen_random_uuid(), "role" text null, "created_at" timestamptz(6) not null, "deal_id" uuid not null, "person_entity_id" uuid not null, constraint "customer_deal_people_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deal_people_deal_idx" on "customer_deal_people" ("deal_id");`);
    this.addSql(`create index "customer_deal_people_person_idx" on "customer_deal_people" ("person_entity_id");`);
    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_unique" unique ("deal_id", "person_entity_id");`);

    this.addSql(`create table "customer_deals" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "status" text not null default 'open', "pipeline_stage" text null, "value_amount" numeric(14,2) null, "value_currency" text null, "probability" int4 null, "expected_close_at" timestamptz(6) null, "owner_user_id" uuid null, "source" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "customer_deals_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_deals_org_tenant_idx" on "customer_deals" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_dictionary_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "value" text not null, "normalized_value" text not null, "label" text not null, "color" text null, "icon" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "customer_dictionary_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_dictionary_entries_scope_idx" on "customer_dictionary_entries" ("organization_id", "tenant_id", "kind");`);
    this.addSql(`alter table "customer_dictionary_entries" add constraint "customer_dictionary_entries_unique" unique ("organization_id", "tenant_id", "kind", "normalized_value");`);

    this.addSql(`create table "customer_entities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "display_name" text not null, "description" text null, "owner_user_id" uuid null, "primary_email" text null, "primary_phone" text null, "status" text null, "lifecycle_stage" text null, "source" text null, "next_interaction_at" timestamptz(6) null, "next_interaction_name" text null, "next_interaction_ref_id" text null, "next_interaction_icon" text null, "next_interaction_color" text null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "customer_entities_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_entities_org_tenant_kind_idx" on "customer_entities" ("organization_id", "tenant_id", "kind");`);
    this.addSql(`create index "idx_ce_tenant_company_id" on "customer_entities" ("tenant_id", "id");`);
    this.addSql(`create index "idx_ce_tenant_org_company_id" on "customer_entities" ("tenant_id", "organization_id", "id");`);
    this.addSql(`create index "idx_ce_tenant_org_person_id" on "customer_entities" ("tenant_id", "organization_id", "id");`);
    this.addSql(`create index "idx_ce_tenant_person_id" on "customer_entities" ("tenant_id", "id");`);

    this.addSql(`create table "customer_people" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "first_name" text null, "last_name" text null, "preferred_name" text null, "job_title" text null, "department" text null, "seniority" text null, "timezone" text null, "linked_in_url" text null, "twitter_url" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "entity_id" uuid not null, "company_entity_id" uuid null, constraint "customer_people_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_people" add constraint "customer_people_entity_id_unique" unique ("entity_id");`);
    this.addSql(`create index "customer_people_org_tenant_idx" on "customer_people" ("organization_id", "tenant_id");`);
    this.addSql(`create index "idx_customer_people_entity_id" on "customer_people" ("entity_id");`);

    this.addSql(`create table "customer_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "address_format" text not null default 'line_first', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "customer_settings_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_settings" add constraint "customer_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "tag_id" uuid not null, "entity_id" uuid not null, constraint "customer_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_tag_assignments_entity_idx" on "customer_tag_assignments" ("entity_id");`);
    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_unique" unique ("tag_id", "entity_id");`);

    this.addSql(`create table "customer_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "customer_tags_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_tags" add constraint "customer_tags_org_slug_unique" unique ("organization_id", "tenant_id", "slug");`);
    this.addSql(`create index "customer_tags_org_tenant_idx" on "customer_tags" ("organization_id", "tenant_id");`);

    this.addSql(`create table "customer_todo_links" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "todo_id" uuid not null, "todo_source" text not null default 'example:todo', "created_at" timestamptz(6) not null, "created_by_user_id" uuid null, "entity_id" uuid not null, constraint "customer_todo_links_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_todo_links_entity_created_idx" on "customer_todo_links" ("entity_id", "created_at");`);
    this.addSql(`create index "customer_todo_links_entity_idx" on "customer_todo_links" ("entity_id");`);
    this.addSql(`alter table "customer_todo_links" add constraint "customer_todo_links_unique" unique ("entity_id", "todo_id", "todo_source");`);

    this.addSql(`create table "dashboard_layouts" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "layout_json" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "dashboard_layouts_pkey" primary key ("id"));`);
    this.addSql(`alter table "dashboard_layouts" add constraint "dashboard_layouts_user_id_tenant_id_organization_id_unique" unique ("user_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "dashboard_role_widgets" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "widget_ids_json" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "dashboard_role_widgets_pkey" primary key ("id"));`);
    this.addSql(`alter table "dashboard_role_widgets" add constraint "dashboard_role_widgets_role_id_tenant_id_organization_id_unique" unique ("role_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "dashboard_user_widgets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "mode" text not null default 'inherit', "widget_ids_json" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "dashboard_user_widgets_pkey" primary key ("id"));`);
    this.addSql(`alter table "dashboard_user_widgets" add constraint "dashboard_user_widgets_user_id_tenant_id_organization_id_unique" unique ("user_id", "tenant_id", "organization_id");`);

    this.addSql(`create table "dictionaries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "description" text null, "is_system" bool not null default false, "is_active" bool not null default true, "manager_visibility" text not null default 'default', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "dictionaries_pkey" primary key ("id"));`);
    this.addSql(`alter table "dictionaries" add constraint "dictionaries_scope_key_unique" unique ("organization_id", "tenant_id", "key");`);

    this.addSql(`create table "dictionary_entries" ("id" uuid not null default gen_random_uuid(), "dictionary_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "value" text not null, "normalized_value" text not null, "label" text not null, "color" text null, "icon" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "dictionary_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "dictionary_entries_scope_idx" on "dictionary_entries" ("dictionary_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "dictionary_entries" add constraint "dictionary_entries_unique" unique ("dictionary_id", "organization_id", "tenant_id", "normalized_value");`);

    this.addSql(`create table "entity_index_coverage" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "tenant_id" uuid null, "organization_id" uuid null, "with_deleted" bool not null default false, "base_count" int4 not null default 0, "indexed_count" int4 not null default 0, "vector_indexed_count" int4 not null default 0, "refreshed_at" timestamptz(6) not null, constraint "entity_index_coverage_pkey" primary key ("id"));`);
    this.addSql(`alter table "entity_index_coverage" add constraint "entity_index_coverage_scope_idx" unique ("entity_type", "tenant_id", "organization_id", "with_deleted");`);

    this.addSql(`create table "entity_index_jobs" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "organization_id" uuid null, "tenant_id" uuid null, "partition_index" int4 null, "partition_count" int4 null, "processed_count" int4 null, "total_count" int4 null, "heartbeat_at" timestamptz(6) null, "status" text not null, "started_at" timestamptz(6) not null, "finished_at" timestamptz(6) null, constraint "entity_index_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index "entity_index_jobs_org_idx" on "entity_index_jobs" ("organization_id");`);
    this.addSql(`create index "entity_index_jobs_type_idx" on "entity_index_jobs" ("entity_type");`);

    this.addSql(`create table "entity_indexes" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "doc" jsonb not null, "embedding" jsonb null, "index_version" int4 not null default 1, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "entity_indexes_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX entity_indexes_customer_company_profile_doc_idx ON public.entity_indexes USING btree (entity_id, organization_id, tenant_id) INCLUDE (doc) WHERE ((deleted_at IS NULL) AND (entity_type = 'customers:customer_company_profile'::text) AND (organization_id IS NOT NULL) AND (tenant_id IS NOT NULL));`);
    this.addSql(`CREATE INDEX entity_indexes_customer_company_profile_tenant_doc_idx ON public.entity_indexes USING btree (tenant_id, entity_id) INCLUDE (doc) WHERE ((deleted_at IS NULL) AND (entity_type = 'customers:customer_company_profile'::text) AND (organization_id IS NULL) AND (tenant_id IS NOT NULL));`);
    this.addSql(`CREATE INDEX entity_indexes_customer_entity_doc_idx ON public.entity_indexes USING btree (entity_id, organization_id, tenant_id) INCLUDE (doc) WHERE ((deleted_at IS NULL) AND (entity_type = 'customers:customer_entity'::text) AND (organization_id IS NOT NULL) AND (tenant_id IS NOT NULL));`);
    this.addSql(`CREATE INDEX entity_indexes_customer_entity_tenant_doc_idx ON public.entity_indexes USING btree (tenant_id, entity_id) INCLUDE (doc) WHERE ((deleted_at IS NULL) AND (entity_type = 'customers:customer_entity'::text) AND (organization_id IS NULL) AND (tenant_id IS NOT NULL));`);
    this.addSql(`CREATE INDEX entity_indexes_customer_person_profile_doc_idx ON public.entity_indexes USING btree (entity_id, organization_id, tenant_id) INCLUDE (doc) WHERE ((deleted_at IS NULL) AND (entity_type = 'customers:customer_person_profile'::text) AND (organization_id IS NOT NULL) AND (tenant_id IS NOT NULL));`);
    this.addSql(`CREATE INDEX entity_indexes_customer_person_profile_tenant_doc_idx ON public.entity_indexes USING btree (tenant_id, entity_id) INCLUDE (doc) WHERE ((deleted_at IS NULL) AND (entity_type = 'customers:customer_person_profile'::text) AND (organization_id IS NULL) AND (tenant_id IS NOT NULL));`);
    this.addSql(`create index "entity_indexes_entity_idx" on "entity_indexes" ("entity_id");`);
    this.addSql(`create index "entity_indexes_org_idx" on "entity_indexes" ("organization_id");`);
    this.addSql(`create index "entity_indexes_type_idx" on "entity_indexes" ("entity_type");`);
    this.addSql(`create index "entity_indexes_type_tenant_idx" on "entity_indexes" ("entity_type", "tenant_id");`);

    this.addSql(`create table "example_items" ("id" uuid not null default gen_random_uuid(), "title" text not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "example_items_pkey" primary key ("id"));`);

    this.addSql(`create table "indexer_error_logs" ("id" uuid not null default gen_random_uuid(), "source" text not null, "handler" text not null, "entity_type" text null, "record_id" text null, "tenant_id" uuid null, "organization_id" uuid null, "payload" jsonb null, "message" text not null, "stack" text null, "occurred_at" timestamptz(6) not null, constraint "indexer_error_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "indexer_error_logs_occurred_idx" on "indexer_error_logs" ("occurred_at");`);
    this.addSql(`create index "indexer_error_logs_source_idx" on "indexer_error_logs" ("source");`);

    this.addSql(`create table "indexer_status_logs" ("id" uuid not null default gen_random_uuid(), "source" text not null, "handler" text not null, "level" text not null default 'info', "entity_type" text null, "record_id" text null, "tenant_id" uuid null, "organization_id" uuid null, "message" text not null, "details" jsonb null, "occurred_at" timestamptz(6) not null default now(), constraint "indexer_status_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "indexer_status_logs_occurred_idx" on "indexer_status_logs" ("occurred_at");`);
    this.addSql(`create index "indexer_status_logs_source_idx" on "indexer_status_logs" ("source");`);

    this.addSql(`create table "mikro_orm_migrations_api_keys" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_attachments" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_audit_logs" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_auth" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_business_rules" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_catalog" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_configs" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_customers" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_dashboards" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_dictionaries" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_directory" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_entities" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_example" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_onboarding" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_perspectives" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_query_index" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_sales" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "module_configs" ("id" uuid not null default gen_random_uuid(), "module_id" text not null, "name" text not null, "value_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "module_configs_pkey" primary key ("id"));`);
    this.addSql(`create index "module_configs_module_idx" on "module_configs" ("module_id");`);
    this.addSql(`alter table "module_configs" add constraint "module_configs_module_name_unique" unique ("module_id", "name");`);

    this.addSql(`create table "onboarding_requests" ("id" uuid not null default gen_random_uuid(), "email" text not null, "token_hash" text not null, "status" text not null default 'pending', "first_name" text not null, "last_name" text not null, "organization_name" text not null, "locale" text null, "terms_accepted" bool not null default false, "expires_at" timestamptz(6) not null, "completed_at" timestamptz(6) null, "tenant_id" uuid null, "organization_id" uuid null, "user_id" uuid null, "last_email_sent_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "password_hash" text null, constraint "onboarding_requests_pkey" primary key ("id"));`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_email_unique" unique ("email");`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "organizations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "name" text not null, "is_active" bool not null default true, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int4 not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "organizations_pkey" primary key ("id"));`);

    this.addSql(`create table "password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "password_resets_pkey" primary key ("id"));`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_unique" unique ("token");`);

    this.addSql(`create table "perspectives" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "table_id" text not null, "name" text not null, "settings_json" jsonb not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "perspectives_pkey" primary key ("id"));`);
    this.addSql(`alter table "perspectives" add constraint "perspectives_user_id_tenant_id_organization_id_ta_2d725_unique" unique ("user_id", "tenant_id", "organization_id", "table_id", "name");`);
    this.addSql(`create index "perspectives_user_scope_idx" on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id");`);

    this.addSql(`create table "role_acls" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" bool not null default false, "organizations_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "role_acls_pkey" primary key ("id"));`);

    this.addSql(`create table "role_perspectives" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "table_id" text not null, "name" text not null, "settings_json" jsonb not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "role_perspectives_pkey" primary key ("id"));`);
    this.addSql(`alter table "role_perspectives" add constraint "role_perspectives_role_id_tenant_id_organization__c5467_unique" unique ("role_id", "tenant_id", "organization_id", "table_id", "name");`);
    this.addSql(`create index "role_perspectives_role_scope_idx" on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id");`);

    this.addSql(`create table "role_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "role_sidebar_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_tenant_id_locale_unique" unique ("role_id", "tenant_id", "locale");`);

    this.addSql(`create table "roles" ("id" uuid not null default gen_random_uuid(), "name" text not null, "tenant_id" uuid null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "roles_pkey" primary key ("id"));`);
    this.addSql(`alter table "roles" add constraint "roles_tenant_id_name_unique" unique ("tenant_id", "name");`);

    this.addSql(`create table "rule_execution_logs" ("id" bigserial primary key, "rule_id" uuid not null, "entity_id" uuid not null, "entity_type" varchar(50) not null, "execution_result" varchar(20) not null, "input_context" jsonb null, "output_context" jsonb null, "error_message" text null, "execution_time_ms" int4 not null, "executed_at" timestamptz(6) not null, "tenant_id" uuid not null, "organization_id" uuid null, "executed_by" varchar(50) null);`);
    this.addSql(`create index "rule_execution_logs_entity_idx" on "rule_execution_logs" ("entity_type", "entity_id");`);
    this.addSql(`create index "rule_execution_logs_result_idx" on "rule_execution_logs" ("execution_result", "executed_at");`);
    this.addSql(`create index "rule_execution_logs_rule_idx" on "rule_execution_logs" ("rule_id");`);
    this.addSql(`create index "rule_execution_logs_tenant_org_idx" on "rule_execution_logs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "rule_set_members" ("id" uuid not null default gen_random_uuid(), "rule_set_id" uuid not null, "rule_id" uuid not null, "sequence" int4 not null default 0, "enabled" bool not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, constraint "rule_set_members_pkey" primary key ("id"));`);
    this.addSql(`create index "rule_set_members_rule_idx" on "rule_set_members" ("rule_id");`);
    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_set_id_rule_id_unique" unique ("rule_set_id", "rule_id");`);
    this.addSql(`create index "rule_set_members_set_idx" on "rule_set_members" ("rule_set_id", "sequence");`);
    this.addSql(`create index "rule_set_members_tenant_org_idx" on "rule_set_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "rule_sets" ("id" uuid not null default gen_random_uuid(), "set_id" varchar(50) not null, "set_name" varchar(200) not null, "description" text null, "enabled" bool not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(50) null, "updated_by" varchar(50) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "rule_sets_pkey" primary key ("id"));`);
    this.addSql(`create index "rule_sets_enabled_idx" on "rule_sets" ("enabled");`);
    this.addSql(`alter table "rule_sets" add constraint "rule_sets_set_id_tenant_id_unique" unique ("set_id", "tenant_id");`);
    this.addSql(`create index "rule_sets_tenant_org_idx" on "rule_sets" ("tenant_id", "organization_id");`);

    this.addSql(`create table "sales_channels" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text null, "description" text null, "status_entry_id" uuid null, "status" text null, "website_url" text null, "contact_email" text null, "contact_phone" text null, "address_line1" text null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "latitude" numeric(10,6) null, "longitude" numeric(10,6) null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_channels_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_channels" add constraint "sales_channels_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_channels_org_tenant_idx" on "sales_channels" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_channels_status_idx" on "sales_channels" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_credit_memo_lines" ("id" uuid not null default gen_random_uuid(), "credit_memo_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "description" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, constraint "sales_credit_memo_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_credit_memo_lines_scope_idx" on "sales_credit_memo_lines" ("credit_memo_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_credit_memos" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "invoice_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "credit_memo_number" text not null, "status_entry_id" uuid null, "status" text null, "issue_date" timestamptz(6) null, "currency_code" text not null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_credit_memos_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_credit_memos" add constraint "sales_credit_memos_number_unique" unique ("organization_id", "tenant_id", "credit_memo_number");`);
    this.addSql(`create index "sales_credit_memos_scope_idx" on "sales_credit_memos" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_credit_memos_status_idx" on "sales_credit_memos" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_delivery_windows" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "lead_time_days" int4 null, "cutoff_time" text null, "timezone" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_delivery_windows_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_delivery_windows" add constraint "sales_delivery_windows_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_delivery_windows_scope_idx" on "sales_delivery_windows" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_document_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_kind" text not null, "current_value" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_document_sequences_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_document_sequences" add constraint "sales_document_sequences_scope_unique" unique ("organization_id", "tenant_id", "document_kind");`);

    this.addSql(`create table "sales_invoice_lines" ("id" uuid not null default gen_random_uuid(), "invoice_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "description" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, constraint "sales_invoice_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_invoice_lines_scope_idx" on "sales_invoice_lines" ("invoice_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_invoices" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "invoice_number" text not null, "status_entry_id" uuid null, "status" text null, "issue_date" timestamptz(6) null, "due_date" timestamptz(6) null, "currency_code" text not null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "paid_total_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_invoices_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_invoices" add constraint "sales_invoices_number_unique" unique ("organization_id", "tenant_id", "invoice_number");`);
    this.addSql(`create index "sales_invoices_scope_idx" on "sales_invoices" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_invoices_status_idx" on "sales_invoices" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_notes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "context_type" text not null, "context_id" uuid not null, "order_id" uuid null, "quote_id" uuid null, "author_user_id" uuid null, "body" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_notes_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_notes_scope_idx" on "sales_notes" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_order_adjustments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "scope" text not null default 'order', "kind" text not null default 'custom', "code" text null, "label" text null, "calculator_key" text null, "promotion_id" uuid null, "rate" numeric(7,4) not null default '0', "amount_net" numeric(18,4) not null default '0', "amount_gross" numeric(18,4) not null default '0', "currency_code" text null, "metadata" jsonb null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_order_adjustments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_order_adjustments_scope_idx" on "sales_order_adjustments" ("order_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_order_lines" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "status_entry_id" uuid null, "status" text null, "product_id" uuid null, "product_variant_id" uuid null, "catalog_snapshot" jsonb null, "name" text null, "description" text null, "comment" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "reserved_quantity" numeric(18,4) not null default '0', "fulfilled_quantity" numeric(18,4) not null default '0', "invoiced_quantity" numeric(18,4) not null default '0', "returned_quantity" numeric(18,4) not null default '0', "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "configuration" jsonb null, "promotion_code" text null, "promotion_snapshot" jsonb null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_order_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_order_lines_scope_idx" on "sales_order_lines" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_order_lines_status_idx" on "sales_order_lines" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_orders" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number" text not null, "external_reference" text null, "customer_reference" text null, "customer_entity_id" uuid null, "customer_contact_id" uuid null, "billing_address_id" uuid null, "shipping_address_id" uuid null, "currency_code" text not null, "exchange_rate" numeric(18,8) null, "status_entry_id" uuid null, "status" text null, "fulfillment_status_entry_id" uuid null, "fulfillment_status" text null, "payment_status_entry_id" uuid null, "payment_status" text null, "tax_strategy_key" text null, "discount_strategy_key" text null, "shipping_method_snapshot" jsonb null, "payment_method_snapshot" jsonb null, "placed_at" timestamptz(6) null, "expected_delivery_at" timestamptz(6) null, "due_at" timestamptz(6) null, "comments" text null, "internal_notes" text null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "shipping_net_amount" numeric(18,4) not null default '0', "shipping_gross_amount" numeric(18,4) not null default '0', "surcharge_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "paid_total_amount" numeric(18,4) not null default '0', "refunded_total_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "line_item_count" int4 not null default 0, "metadata" jsonb null, "custom_field_set_id" uuid null, "channel_id" uuid null, "channel_ref_id" uuid null, "shipping_method_id" uuid null, "shipping_method_ref_id" uuid null, "delivery_window_id" uuid null, "delivery_window_ref_id" uuid null, "payment_method_id" uuid null, "payment_method_ref_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "customer_snapshot" jsonb null, "billing_address_snapshot" jsonb null, "shipping_address_snapshot" jsonb null, "tax_info" jsonb null, "delivery_window_snapshot" jsonb null, "shipping_method_code" text null, "delivery_window_code" text null, "payment_method_code" text null, constraint "sales_orders_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_orders_customer_idx" on "sales_orders" ("customer_entity_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_orders_fulfillment_status_idx" on "sales_orders" ("organization_id", "tenant_id", "fulfillment_status");`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_number_unique" unique ("organization_id", "tenant_id", "order_number");`);
    this.addSql(`create index "sales_orders_org_tenant_idx" on "sales_orders" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_orders_payment_status_idx" on "sales_orders" ("organization_id", "tenant_id", "payment_status");`);
    this.addSql(`create index "sales_orders_status_idx" on "sales_orders" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_payment_allocations" ("id" uuid not null default gen_random_uuid(), "payment_id" uuid not null, "order_id" uuid null, "invoice_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "amount" numeric(18,4) not null default '0', "currency_code" text not null, "metadata" jsonb null, constraint "sales_payment_allocations_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_payment_allocations_scope_idx" on "sales_payment_allocations" ("payment_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_payment_methods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "provider_key" text null, "terms" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_payment_methods_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_payment_methods" add constraint "sales_payment_methods_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_payment_methods_scope_idx" on "sales_payment_methods" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_payments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "payment_method_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "payment_reference" text null, "status_entry_id" uuid null, "status" text null, "amount" numeric(18,4) not null default '0', "currency_code" text not null, "captured_amount" numeric(18,4) not null default '0', "refunded_amount" numeric(18,4) not null default '0', "received_at" timestamptz(6) null, "captured_at" timestamptz(6) null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_payments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_payments_scope_idx" on "sales_payments" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_payments_status_idx" on "sales_payments" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_quote_adjustments" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "quote_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "scope" text not null default 'order', "kind" text not null default 'custom', "code" text null, "label" text null, "calculator_key" text null, "promotion_id" uuid null, "rate" numeric(7,4) not null default '0', "amount_net" numeric(18,4) not null default '0', "amount_gross" numeric(18,4) not null default '0', "currency_code" text null, "metadata" jsonb null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_quote_adjustments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_quote_adjustments_scope_idx" on "sales_quote_adjustments" ("quote_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_quote_lines" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "status_entry_id" uuid null, "status" text null, "product_id" uuid null, "product_variant_id" uuid null, "catalog_snapshot" jsonb null, "name" text null, "description" text null, "comment" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "configuration" jsonb null, "promotion_code" text null, "promotion_snapshot" jsonb null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_quote_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_quote_lines_scope_idx" on "sales_quote_lines" ("quote_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_quote_lines_status_idx" on "sales_quote_lines" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_quotes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_number" text not null, "status_entry_id" uuid null, "status" text null, "customer_entity_id" uuid null, "customer_contact_id" uuid null, "currency_code" text not null, "valid_from" timestamptz(6) null, "valid_until" timestamptz(6) null, "comments" text null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "line_item_count" int4 not null default 0, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "converted_order_id" uuid null, "customer_snapshot" jsonb null, "billing_address_id" uuid null, "shipping_address_id" uuid null, "billing_address_snapshot" jsonb null, "shipping_address_snapshot" jsonb null, "tax_info" jsonb null, "shipping_method_id" uuid null, "shipping_method_code" text null, "shipping_method_ref_id" uuid null, "delivery_window_id" uuid null, "delivery_window_code" text null, "delivery_window_ref_id" uuid null, "payment_method_id" uuid null, "payment_method_code" text null, "payment_method_ref_id" uuid null, "shipping_method_snapshot" jsonb null, "delivery_window_snapshot" jsonb null, "payment_method_snapshot" jsonb null, "channel_id" uuid null, "channel_ref_id" uuid null, constraint "sales_quotes_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_number_unique" unique ("organization_id", "tenant_id", "quote_number");`);
    this.addSql(`create index "sales_quotes_scope_idx" on "sales_quotes" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_quotes_status_idx" on "sales_quotes" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number_format" text not null default 'ORDER-{yyyy}{mm}{dd}-{seq:5}', "quote_number_format" text not null default 'QUOTE-{yyyy}{mm}{dd}-{seq:5}', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_settings_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_settings" add constraint "sales_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_shipment_items" ("id" uuid not null default gen_random_uuid(), "shipment_id" uuid not null, "order_line_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "quantity" numeric(18,4) not null default '0', "metadata" jsonb null, constraint "sales_shipment_items_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_shipment_items_scope_idx" on "sales_shipment_items" ("shipment_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_shipments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "shipment_number" text null, "shipping_method_id" uuid null, "status_entry_id" uuid null, "status" text null, "carrier_name" text null, "tracking_numbers" jsonb null, "shipped_at" timestamptz(6) null, "delivered_at" timestamptz(6) null, "weight_value" numeric(16,4) null, "weight_unit" text null, "declared_value_net" numeric(18,4) null, "declared_value_gross" numeric(18,4) null, "currency_code" text null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_shipments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_shipments_scope_idx" on "sales_shipments" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_shipments_status_idx" on "sales_shipments" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_shipping_methods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "carrier_code" text null, "service_level" text null, "estimated_transit_days" int4 null, "base_rate_net" numeric(16,4) not null default '0', "base_rate_gross" numeric(16,4) not null default '0', "currency_code" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_shipping_methods_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_shipping_methods" add constraint "sales_shipping_methods_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_shipping_methods_scope_idx" on "sales_shipping_methods" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_tax_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "rate" numeric(7,4) not null, "country_code" text null, "region_code" text null, "postal_code" text null, "city" text null, "customer_group_id" uuid null, "product_category_id" uuid null, "channel_id" uuid null, "priority" int4 not null default 0, "is_compound" bool not null default false, "metadata" jsonb null, "starts_at" timestamptz(6) null, "ends_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "is_default" bool not null default false, constraint "sales_tax_rates_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_tax_rates" add constraint "sales_tax_rates_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_tax_rates_scope_idx" on "sales_tax_rates" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, "last_used_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "sessions_pkey" primary key ("id"));`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_unique" unique ("token");`);

    this.addSql(`create table "tenants" ("id" uuid not null default gen_random_uuid(), "name" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "tenants_pkey" primary key ("id"));`);

    this.addSql(`create table "todos" ("id" uuid not null default gen_random_uuid(), "title" text not null, "tenant_id" uuid null, "organization_id" uuid null, "is_done" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "todos_pkey" primary key ("id"));`);

    this.addSql(`create table "upgrade_action_runs" ("id" uuid not null default gen_random_uuid(), "version" text not null, "action_id" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "completed_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, constraint "upgrade_action_runs_pkey" primary key ("id"));`);
    this.addSql(`alter table "upgrade_action_runs" add constraint "upgrade_action_runs_action_scope_unique" unique ("version", "action_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "upgrade_action_runs_scope_idx" on "upgrade_action_runs" ("organization_id", "tenant_id");`);

    this.addSql(`create table "user_acls" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" bool not null default false, "organizations_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "user_acls_pkey" primary key ("id"));`);

    this.addSql(`create table "user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "user_roles_pkey" primary key ("id"));`);

    this.addSql(`create table "user_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "user_sidebar_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_tenant_id_organi_f3f2f_unique" unique ("user_id", "tenant_id", "organization_id", "locale");`);

    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "email" text not null, "name" text null, "password_hash" text null, "is_confirmed" bool not null default true, "last_login_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "vector_search" ("id" uuid not null default gen_random_uuid(), "driver_id" text not null, "entity_id" text not null, "record_id" text not null, "tenant_id" uuid not null, "organization_id" uuid null, "checksum" text not null, "embedding" vector(1536) not null, "url" text null, "presenter" jsonb null, "links" jsonb null, "payload" jsonb null, "result_title" text null, "result_subtitle" text null, "result_icon" text null, "result_badge" text null, "result_snapshot" text null, "primary_link_href" text null, "primary_link_label" text null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), constraint "vector_search_pkey" primary key ("id"));`);
    this.addSql(`create index "vector_search_embedding_idx" on "vector_search" ("embedding");`);
    this.addSql(`create index "vector_search_lookup" on "vector_search" ("tenant_id", "organization_id", "entity_id");`);
    this.addSql(`alter table "vector_search" add constraint "vector_search_uniq" unique ("driver_id", "entity_id", "record_id", "tenant_id");`);

    this.addSql(`create table "vector_search_migrations" ("id" text not null, "applied_at" timestamptz(6) not null default now(), constraint "vector_search_migrations_pkey" primary key ("id"));`);
  }

}
