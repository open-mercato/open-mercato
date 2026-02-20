import { Migration } from '@mikro-orm/migrations';

export class Migration20260220164229 extends Migration {

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

    this.addSql(`alter table "feature_toggle_audit_logs" drop constraint "feature_toggle_audit_logs_toggle_id_foreign";`);

    this.addSql(`alter table "feature_toggle_overrides" drop constraint "feature_toggle_overrides_toggle_id_foreign";`);

    this.addSql(`alter table "resources_resource_tag_assignments" drop constraint "resources_resource_tag_assignments_tag_id_foreign";`);

    this.addSql(`alter table "resources_resource_activities" drop constraint "resources_resource_activities_resource_id_foreign";`);

    this.addSql(`alter table "resources_resource_comments" drop constraint "resources_resource_comments_resource_id_foreign";`);

    this.addSql(`alter table "resources_resource_tag_assignments" drop constraint "resources_resource_tag_assignments_resource_id_foreign";`);

    this.addSql(`alter table "role_acls" drop constraint "role_acls_role_id_foreign";`);

    this.addSql(`alter table "role_sidebar_preferences" drop constraint "role_sidebar_preferences_role_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_role_id_foreign";`);

    this.addSql(`alter table "rule_set_members" drop constraint "rule_set_members_rule_set_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_channel_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_channel_ref_id_foreign";`);

    this.addSql(`alter table "sales_credit_memo_lines" drop constraint "sales_credit_memo_lines_credit_memo_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_delivery_window_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_delivery_window_ref_id_foreign";`);

    this.addSql(`alter table "sales_document_tag_assignments" drop constraint "sales_document_tag_assignments_tag_id_foreign";`);

    this.addSql(`alter table "sales_credit_memos" drop constraint "sales_credit_memos_invoice_id_foreign";`);

    this.addSql(`alter table "sales_invoice_lines" drop constraint "sales_invoice_lines_invoice_id_foreign";`);

    this.addSql(`alter table "sales_payment_allocations" drop constraint "sales_payment_allocations_invoice_id_foreign";`);

    this.addSql(`alter table "sales_credit_memo_lines" drop constraint "sales_credit_memo_lines_order_line_id_foreign";`);

    this.addSql(`alter table "sales_invoice_lines" drop constraint "sales_invoice_lines_order_line_id_foreign";`);

    this.addSql(`alter table "sales_order_adjustments" drop constraint "sales_order_adjustments_order_line_id_foreign";`);

    this.addSql(`alter table "sales_shipment_items" drop constraint "sales_shipment_items_order_line_id_foreign";`);

    this.addSql(`alter table "sales_credit_memos" drop constraint "sales_credit_memos_order_id_foreign";`);

    this.addSql(`alter table "sales_document_addresses" drop constraint "sales_document_addresses_order_id_foreign";`);

    this.addSql(`alter table "sales_document_tag_assignments" drop constraint "sales_document_tag_assignments_order_id_foreign";`);

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

    this.addSql(`alter table "sales_document_addresses" drop constraint "sales_document_addresses_quote_id_foreign";`);

    this.addSql(`alter table "sales_document_tag_assignments" drop constraint "sales_document_tag_assignments_quote_id_foreign";`);

    this.addSql(`alter table "sales_notes" drop constraint "sales_notes_quote_id_foreign";`);

    this.addSql(`alter table "sales_quote_adjustments" drop constraint "sales_quote_adjustments_quote_id_foreign";`);

    this.addSql(`alter table "sales_quote_lines" drop constraint "sales_quote_lines_quote_id_foreign";`);

    this.addSql(`alter table "sales_shipment_items" drop constraint "sales_shipment_items_shipment_id_foreign";`);

    this.addSql(`alter table "sales_orders" drop constraint "sales_orders_shipping_method_ref_id_foreign";`);

    this.addSql(`alter table "sales_quotes" drop constraint "sales_quotes_shipping_method_ref_id_foreign";`);

    this.addSql(`alter table "staff_leave_requests" drop constraint "staff_leave_requests_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_activities" drop constraint "staff_team_member_activities_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_addresses" drop constraint "staff_team_member_addresses_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_comments" drop constraint "staff_team_member_comments_member_id_foreign";`);

    this.addSql(`alter table "staff_team_member_job_histories" drop constraint "staff_team_member_job_histories_member_id_foreign";`);

    this.addSql(`alter table "organizations" drop constraint "organizations_tenant_id_foreign";`);

    this.addSql(`alter table "password_resets" drop constraint "password_resets_user_id_foreign";`);

    this.addSql(`alter table "sessions" drop constraint "sessions_user_id_foreign";`);

    this.addSql(`alter table "user_acls" drop constraint "user_acls_user_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_user_id_foreign";`);

    this.addSql(`alter table "user_sidebar_preferences" drop constraint "user_sidebar_preferences_user_id_foreign";`);

    this.addSql(`drop index "entity_translations_scope_uq";`);

    this.addSql(`alter table "entity_translations" alter column "translations" drop default;`);
    this.addSql(`alter table "entity_translations" alter column "translations" type jsonb using ("translations"::jsonb);`);
    this.addSql(`alter table "entity_translations" alter column "created_at" drop default;`);
    this.addSql(`alter table "entity_translations" alter column "created_at" type timestamptz using ("created_at"::timestamptz);`);
    this.addSql(`alter table "entity_translations" alter column "updated_at" drop default;`);
    this.addSql(`alter table "entity_translations" alter column "updated_at" type timestamptz using ("updated_at"::timestamptz);`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "access_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "actor_user_id" uuid null, "resource_kind" text not null, "resource_id" text not null, "access_type" text not null, "fields_json" jsonb null, "context_json" jsonb null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "access_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "access_logs_actor_idx" on "access_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "access_logs_tenant_idx" on "access_logs" ("tenant_id", "created_at");`);

    this.addSql(`create table "action_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "actor_user_id" uuid null, "command_id" text not null, "action_label" text null, "resource_kind" text null, "resource_id" text null, "execution_state" text not null default 'done', "undo_token" text null, "command_payload" jsonb null, "snapshot_before" jsonb null, "snapshot_after" jsonb null, "changes_json" jsonb null, "context_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "parent_resource_kind" text null, "parent_resource_id" text null, constraint "action_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "action_logs_actor_idx" on "action_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "action_logs_parent_resource_idx" on "action_logs" ("tenant_id", "parent_resource_kind", "parent_resource_id", "created_at");`);
    this.addSql(`create index "action_logs_resource_idx" on "action_logs" ("tenant_id", "resource_kind", "resource_id", "created_at");`);
    this.addSql(`create index "action_logs_tenant_idx" on "action_logs" ("tenant_id", "created_at");`);

    this.addSql(`create table "api_keys" ("id" uuid not null default gen_random_uuid(), "name" text not null, "description" text null, "tenant_id" uuid null, "organization_id" uuid null, "key_hash" text not null, "key_prefix" text not null, "roles_json" jsonb null, "created_by" uuid null, "last_used_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "session_token" text null, "session_user_id" uuid null, "session_secret_encrypted" text null, constraint "api_keys_pkey" primary key ("id"));`);
    this.addSql(`alter table "api_keys" add constraint "api_keys_key_prefix_unique" unique ("key_prefix");`);

    this.addSql(`create table "attachment_partitions" ("id" uuid not null default gen_random_uuid(), "code" text not null, "title" text not null, "description" text null, "storage_driver" text not null default 'local', "config_json" jsonb null, "is_public" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "requires_ocr" bool not null default true, "ocr_model" text null, constraint "attachment_partitions_pkey" primary key ("id"));`);
    this.addSql(`alter table "attachment_partitions" add constraint "attachment_partitions_code_unique" unique ("code");`);

    this.addSql(`create table "attachments" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "record_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "file_name" text not null, "mime_type" text not null, "file_size" int4 not null, "url" text not null, "created_at" timestamptz(6) not null, "partition_code" text not null, "storage_driver" text not null default 'local', "storage_path" text not null, "storage_metadata" jsonb null, "content" text null, constraint "attachments_pkey" primary key ("id"));`);
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

    this.addSql(`create table "catalog_product_offers" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "channel_id" uuid not null, "title" text not null, "description" text null, "metadata" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_media_id" uuid null, "default_media_url" text null, constraint "catalog_product_offers_pkey" primary key ("id"));`);
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

    this.addSql(`create table "catalog_product_variants" ("id" uuid not null default gen_random_uuid(), "product_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "name" text null, "sku" text null, "barcode" text null, "status_entry_id" text null, "is_default" bool not null default false, "is_active" bool not null default true, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "custom_fieldset_code" text null, "default_media_id" uuid null, "default_media_url" text null, "tax_rate_id" uuid null, "tax_rate" numeric(7,4) null, "option_values" jsonb null, constraint "catalog_product_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "catalog_product_variants_scope_idx" on "catalog_product_variants" ("product_id", "organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_sku_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "catalog_products" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" text not null, "description" text null, "subtitle" text null, "status_entry_id" uuid null, "primary_currency_code" text null, "default_unit" text null, "metadata" jsonb null, "is_configurable" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "product_type" text not null default 'simple', "sku" text null, "handle" text null, "option_schema_id" uuid null, "custom_fieldset_code" text null, "default_media_id" uuid null, "default_media_url" text null, "weight_value" numeric(16,4) null, "weight_unit" text null, "dimensions" jsonb null, "tax_rate_id" uuid null, "tax_rate" numeric(7,4) null, constraint "catalog_products_pkey" primary key ("id"));`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_handle_scope_unique" unique ("organization_id", "tenant_id", "handle");`);
    this.addSql(`create index "catalog_products_org_tenant_idx" on "catalog_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "catalog_products" add constraint "catalog_products_sku_scope_unique" unique ("organization_id", "tenant_id", "sku");`);

    this.addSql(`create table "currencies" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "symbol" text null, "decimal_places" int4 not null default 2, "thousands_separator" text null, "decimal_separator" text null, "is_base" bool not null default false, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "currencies_pkey" primary key ("id"));`);
    this.addSql(`alter table "currencies" add constraint "currencies_code_scope_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "currencies_scope_idx" on "currencies" ("organization_id", "tenant_id");`);

    this.addSql(`create table "currency_fetch_configs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "provider" text not null, "is_enabled" bool not null default false, "sync_time" text null, "last_sync_at" timestamptz(6) null, "last_sync_status" text null, "last_sync_message" text null, "last_sync_count" int4 null, "config" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "currency_fetch_configs_pkey" primary key ("id"));`);
    this.addSql(`create index "currency_fetch_configs_enabled_idx" on "currency_fetch_configs" ("is_enabled", "sync_time");`);
    this.addSql(`alter table "currency_fetch_configs" add constraint "currency_fetch_configs_provider_scope_unique" unique ("organization_id", "tenant_id", "provider");`);
    this.addSql(`create index "currency_fetch_configs_scope_idx" on "currency_fetch_configs" ("organization_id", "tenant_id");`);

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

    this.addSql(`create table "encryption_maps" ("id" uuid not null default gen_random_uuid(), "entity_id" text not null, "tenant_id" uuid null, "organization_id" uuid null, "fields_json" jsonb null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "encryption_maps_pkey" primary key ("id"));`);
    this.addSql(`create index "encryption_maps_entity_scope_idx" on "encryption_maps" ("entity_id", "tenant_id", "organization_id");`);

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

    this.addSql(`create table "exchange_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "from_currency_code" text not null, "to_currency_code" text not null, "rate" numeric(18,8) not null, "date" timestamptz(6) not null, "source" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "type" text null, constraint "exchange_rates_pkey" primary key ("id"));`);
    this.addSql(`alter table "exchange_rates" add constraint "exchange_rates_pair_datetime_source_unique" unique ("organization_id", "tenant_id", "from_currency_code", "to_currency_code", "date", "source");`);
    this.addSql(`create index "exchange_rates_pair_idx" on "exchange_rates" ("from_currency_code", "to_currency_code", "date");`);
    this.addSql(`create index "exchange_rates_scope_idx" on "exchange_rates" ("organization_id", "tenant_id");`);

    this.addSql(`create table "feature_toggle_audit_logs" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "organization_id" uuid null, "actor_user_id" uuid null, "action" text not null, "previous_value" jsonb null, "new_value" jsonb null, "changed_fields" jsonb null, "created_at" timestamptz(6) not null, constraint "feature_toggle_audit_logs_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggle_audit_action_idx" on "feature_toggle_audit_logs" ("action", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_actor_idx" on "feature_toggle_audit_logs" ("actor_user_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_org_idx" on "feature_toggle_audit_logs" ("organization_id", "created_at");`);
    this.addSql(`create index "feature_toggle_audit_toggle_idx" on "feature_toggle_audit_logs" ("toggle_id", "created_at");`);

    this.addSql(`create table "feature_toggle_overrides" ("id" uuid not null default gen_random_uuid(), "toggle_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "value" jsonb not null, constraint "feature_toggle_overrides_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggle_overrides_tenant_idx" on "feature_toggle_overrides" ("tenant_id");`);
    this.addSql(`create index "feature_toggle_overrides_toggle_idx" on "feature_toggle_overrides" ("toggle_id");`);
    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_tenant_unique" unique ("toggle_id", "tenant_id");`);

    this.addSql(`create table "feature_toggles" ("id" uuid not null default gen_random_uuid(), "identifier" text not null, "name" text not null, "description" text null, "category" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "default_value" jsonb not null, "type" text not null, constraint "feature_toggles_pkey" primary key ("id"));`);
    this.addSql(`create index "feature_toggles_category_idx" on "feature_toggles" ("category");`);
    this.addSql(`alter table "feature_toggles" add constraint "feature_toggles_identifier_unique" unique ("identifier");`);
    this.addSql(`create index "feature_toggles_name_idx" on "feature_toggles" ("name");`);

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

    this.addSql(`create table "mikro_orm_migrations_currencies" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_customers" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_dashboards" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_dictionaries" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_directory" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_entities" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_example" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_feature_toggles" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_notifications" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_onboarding" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_perspectives" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_planner" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_query_index" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_record_locks" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_resources" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_sales" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_scheduler" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_staff" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "mikro_orm_migrations_workflows" ("id" serial primary key, "name" varchar(255) null, "executed_at" timestamptz(6) null default CURRENT_TIMESTAMP);`);

    this.addSql(`create table "module_configs" ("id" uuid not null default gen_random_uuid(), "module_id" text not null, "name" text not null, "value_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "module_configs_pkey" primary key ("id"));`);
    this.addSql(`create index "module_configs_module_idx" on "module_configs" ("module_id");`);
    this.addSql(`alter table "module_configs" add constraint "module_configs_module_name_unique" unique ("module_id", "name");`);

    this.addSql(`create table "notifications" ("id" uuid not null default gen_random_uuid(), "recipient_user_id" uuid not null, "type" text not null, "title" text not null, "body" text null, "icon" text null, "severity" text not null default 'info', "status" text not null default 'unread', "action_data" jsonb null, "action_result" jsonb null, "action_taken" text null, "source_module" text null, "source_entity_type" text null, "source_entity_id" uuid null, "link_href" text null, "group_key" text null, "created_at" timestamptz(6) not null default now(), "read_at" timestamptz(6) null, "actioned_at" timestamptz(6) null, "dismissed_at" timestamptz(6) null, "expires_at" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid null, "title_key" text null, "body_key" text null, "title_variables" jsonb null, "body_variables" jsonb null, constraint "notifications_pkey" primary key ("id"));`);
    this.addSql(`comment on column "notifications"."title_key" is 'i18n key for notification title';`);
    this.addSql(`comment on column "notifications"."body_key" is 'i18n key for notification body';`);
    this.addSql(`comment on column "notifications"."title_variables" is 'Variables for i18n interpolation in title';`);
    this.addSql(`comment on column "notifications"."body_variables" is 'Variables for i18n interpolation in body';`);
    this.addSql(`CREATE INDEX notifications_expires_idx ON public.notifications USING btree (expires_at) WHERE ((expires_at IS NOT NULL) AND (status <> ALL (ARRAY['actioned'::text, 'dismissed'::text])));`);
    this.addSql(`CREATE INDEX notifications_group_idx ON public.notifications USING btree (group_key, recipient_user_id) WHERE (group_key IS NOT NULL);`);
    this.addSql(`create index "notifications_recipient_status_idx" on "notifications" ("recipient_user_id", "status", "created_at");`);
    this.addSql(`CREATE INDEX notifications_source_idx ON public.notifications USING btree (source_entity_type, source_entity_id) WHERE (source_entity_id IS NOT NULL);`);
    this.addSql(`create index "notifications_tenant_idx" on "notifications" ("tenant_id", "organization_id");`);

    this.addSql(`create table "onboarding_requests" ("id" uuid not null default gen_random_uuid(), "email" text not null, "token_hash" text not null, "status" text not null default 'pending', "first_name" text not null, "last_name" text not null, "organization_name" text not null, "locale" text null, "terms_accepted" bool not null default false, "password_hash" text null, "expires_at" timestamptz(6) not null, "completed_at" timestamptz(6) null, "tenant_id" uuid null, "organization_id" uuid null, "user_id" uuid null, "last_email_sent_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, "processing_started_at" timestamptz(6) null, constraint "onboarding_requests_pkey" primary key ("id"));`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_email_unique" unique ("email");`);
    this.addSql(`alter table "onboarding_requests" add constraint "onboarding_requests_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "organizations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "name" text not null, "is_active" bool not null default true, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int4 not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "organizations_pkey" primary key ("id"));`);

    this.addSql(`create table "password_resets" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "used_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "password_resets_pkey" primary key ("id"));`);
    this.addSql(`alter table "password_resets" add constraint "password_resets_token_unique" unique ("token");`);

    this.addSql(`create table "perspectives" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "table_id" text not null, "name" text not null, "settings_json" jsonb not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "perspectives_pkey" primary key ("id"));`);
    this.addSql(`alter table "perspectives" add constraint "perspectives_user_id_tenant_id_organization_id_ta_2d725_unique" unique ("user_id", "tenant_id", "organization_id", "table_id", "name");`);
    this.addSql(`create index "perspectives_user_scope_idx" on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id");`);

    this.addSql(`create table "planner_availability_rule_sets" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "timezone" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "planner_availability_rule_sets_pkey" primary key ("id"));`);
    this.addSql(`create index "planner_availability_rule_sets_tenant_org_idx" on "planner_availability_rule_sets" ("tenant_id", "organization_id");`);

    this.addSql(`create table "planner_availability_rules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "subject_type" text check ("subject_type" in ('member', 'resource', 'ruleset')) not null, "subject_id" uuid not null, "timezone" text not null, "rrule" text not null, "exdates" jsonb not null default '[]', "kind" text check ("kind" in ('availability', 'unavailability')) not null default 'availability', "note" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "unavailability_reason_entry_id" uuid null, "unavailability_reason_value" text null, constraint "planner_availability_rules_pkey" primary key ("id"));`);
    this.addSql(`create index "planner_availability_rules_subject_idx" on "planner_availability_rules" ("subject_type", "subject_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "planner_availability_rules_tenant_org_idx" on "planner_availability_rules" ("tenant_id", "organization_id");`);

    this.addSql(`create table "record_lock_conflicts" ("id" uuid not null default gen_random_uuid(), "resource_kind" text not null, "resource_id" text not null, "status" text not null default 'pending', "resolution" text null, "base_action_log_id" uuid null, "incoming_action_log_id" uuid null, "conflict_actor_user_id" uuid not null, "incoming_actor_user_id" uuid null, "resolved_by_user_id" uuid null, "resolved_at" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "record_lock_conflicts_pkey" primary key ("id"));`);
    this.addSql(`create index "record_lock_conflicts_resource_idx" on "record_lock_conflicts" ("tenant_id", "resource_kind", "resource_id", "status", "created_at");`);
    this.addSql(`create index "record_lock_conflicts_users_idx" on "record_lock_conflicts" ("tenant_id", "conflict_actor_user_id", "incoming_actor_user_id", "created_at");`);

    this.addSql(`create table "record_locks" ("id" uuid not null default gen_random_uuid(), "resource_kind" text not null, "resource_id" text not null, "token" text not null, "strategy" text not null default 'optimistic', "status" text not null default 'active', "locked_by_user_id" uuid not null, "base_action_log_id" uuid null, "locked_at" timestamptz(6) not null, "last_heartbeat_at" timestamptz(6) not null, "expires_at" timestamptz(6) not null, "released_at" timestamptz(6) null, "released_by_user_id" uuid null, "release_reason" text null, "tenant_id" uuid not null, "organization_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "record_locks_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX record_locks_active_scope_org_unique ON public.record_locks USING btree (tenant_id, organization_id, resource_kind, resource_id) WHERE ((deleted_at IS NULL) AND (status = 'active'::text) AND (organization_id IS NOT NULL));`);
    this.addSql(`CREATE UNIQUE INDEX record_locks_active_scope_tenant_unique ON public.record_locks USING btree (tenant_id, resource_kind, resource_id) WHERE ((deleted_at IS NULL) AND (status = 'active'::text) AND (organization_id IS NULL));`);
    this.addSql(`create index "record_locks_expiry_status_idx" on "record_locks" ("tenant_id", "expires_at", "status");`);
    this.addSql(`create index "record_locks_owner_status_idx" on "record_locks" ("tenant_id", "locked_by_user_id", "status");`);
    this.addSql(`create index "record_locks_resource_status_idx" on "record_locks" ("tenant_id", "resource_kind", "resource_id", "status");`);
    this.addSql(`alter table "record_locks" add constraint "record_locks_token_unique" unique ("token");`);

    this.addSql(`create table "resources_resource_activities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz(6) null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "resource_id" uuid not null, constraint "resources_resource_activities_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_activities_resource_idx" on "resources_resource_activities" ("resource_id");`);
    this.addSql(`create index "resources_resource_activities_resource_occurred_created_idx" on "resources_resource_activities" ("resource_id", "occurred_at", "created_at");`);
    this.addSql(`create index "resources_resource_activities_tenant_org_idx" on "resources_resource_activities" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resource_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "resource_id" uuid not null, constraint "resources_resource_comments_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_comments_resource_idx" on "resources_resource_comments" ("resource_id");`);
    this.addSql(`create index "resources_resource_comments_tenant_org_idx" on "resources_resource_comments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resource_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "resource_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "resources_resource_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_tag_assignments_scope_idx" on "resources_resource_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_unique" unique ("tag_id", "resource_id");`);

    this.addSql(`create table "resources_resource_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "resources_resource_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_tags_scope_idx" on "resources_resource_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "resources_resource_tags" add constraint "resources_resource_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "resources_resource_types" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "resources_resource_types_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resource_types_tenant_org_idx" on "resources_resource_types" ("tenant_id", "organization_id");`);

    this.addSql(`create table "resources_resources" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "resource_type_id" uuid null, "capacity" int4 null, "capacity_unit_value" text null, "capacity_unit_name" text null, "capacity_unit_color" text null, "capacity_unit_icon" text null, "appearance_icon" text null, "appearance_color" text null, "is_active" bool not null default true, "availability_rule_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "resources_resources_pkey" primary key ("id"));`);
    this.addSql(`create index "resources_resources_tenant_org_idx" on "resources_resources" ("tenant_id", "organization_id");`);

    this.addSql(`create table "role_acls" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" bool not null default false, "organizations_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "role_acls_pkey" primary key ("id"));`);

    this.addSql(`create table "role_perspectives" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "table_id" text not null, "name" text not null, "settings_json" jsonb not null, "is_default" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "role_perspectives_pkey" primary key ("id"));`);
    this.addSql(`alter table "role_perspectives" add constraint "role_perspectives_role_id_tenant_id_organization__c5467_unique" unique ("role_id", "tenant_id", "organization_id", "table_id", "name");`);
    this.addSql(`create index "role_perspectives_role_scope_idx" on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id");`);

    this.addSql(`create table "role_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "role_sidebar_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_tenant_id_locale_unique" unique ("role_id", "tenant_id", "locale");`);

    this.addSql(`create table "roles" ("id" uuid not null default gen_random_uuid(), "name" text not null, "tenant_id" uuid null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "roles_pkey" primary key ("id"));`);
    this.addSql(`alter table "roles" add constraint "roles_tenant_id_name_unique" unique ("tenant_id", "name");`);

    this.addSql(`create table "rule_execution_logs" ("id" bigserial primary key, "rule_id" uuid not null, "entity_id" varchar(255) not null, "entity_type" varchar(50) not null, "execution_result" varchar(20) not null, "input_context" jsonb null, "output_context" jsonb null, "error_message" text null, "execution_time_ms" int4 not null, "executed_at" timestamptz(6) not null, "tenant_id" uuid not null, "organization_id" uuid null, "executed_by" varchar(50) null);`);
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

    this.addSql(`create table "sales_document_addresses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "document_kind" text not null, "order_id" uuid null, "quote_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "customer_address_id" uuid null, "name" text null, "purpose" text null, "company_name" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" float4 null, "longitude" float4 null, "deleted_at" timestamptz(6) null, constraint "sales_document_addresses_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_document_addresses_scope_idx" on "sales_document_addresses" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_document_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_kind" text not null, "current_value" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_document_sequences_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_document_sequences" add constraint "sales_document_sequences_scope_unique" unique ("organization_id", "tenant_id", "document_kind");`);

    this.addSql(`create table "sales_document_tag_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "tag_id" uuid not null, "document_id" uuid not null, "document_kind" text not null, "order_id" uuid null, "quote_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_document_tag_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_document_tag_assignments_scope_idx" on "sales_document_tag_assignments" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_unique" unique ("tag_id", "document_id", "document_kind");`);

    this.addSql(`create table "sales_document_tags" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "label" text not null, "color" text null, "description" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "sales_document_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_document_tags_scope_idx" on "sales_document_tags" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_document_tags" add constraint "sales_document_tags_slug_unique" unique ("organization_id", "tenant_id", "slug");`);

    this.addSql(`create table "sales_invoice_lines" ("id" uuid not null default gen_random_uuid(), "invoice_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "description" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "metadata" jsonb null, constraint "sales_invoice_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_invoice_lines_scope_idx" on "sales_invoice_lines" ("invoice_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_invoices" ("id" uuid not null default gen_random_uuid(), "order_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "invoice_number" text not null, "status_entry_id" uuid null, "status" text null, "issue_date" timestamptz(6) null, "due_date" timestamptz(6) null, "currency_code" text not null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "paid_total_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_invoices_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_invoices" add constraint "sales_invoices_number_unique" unique ("organization_id", "tenant_id", "invoice_number");`);
    this.addSql(`create index "sales_invoices_scope_idx" on "sales_invoices" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_invoices_status_idx" on "sales_invoices" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_notes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "context_type" text not null, "context_id" uuid not null, "order_id" uuid null, "quote_id" uuid null, "author_user_id" uuid null, "body" text not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "appearance_icon" text null, "appearance_color" text null, "deleted_at" timestamptz(6) null, constraint "sales_notes_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_notes_scope_idx" on "sales_notes" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_order_adjustments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "order_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "scope" text not null default 'order', "kind" text not null default 'custom', "code" text null, "label" text null, "calculator_key" text null, "promotion_id" uuid null, "rate" numeric(7,4) not null default '0', "amount_net" numeric(18,4) not null default '0', "amount_gross" numeric(18,4) not null default '0', "currency_code" text null, "metadata" jsonb null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_order_adjustments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_order_adjustments_scope_idx" on "sales_order_adjustments" ("order_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_order_lines" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "status_entry_id" uuid null, "status" text null, "product_id" uuid null, "product_variant_id" uuid null, "catalog_snapshot" jsonb null, "name" text null, "description" text null, "comment" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "reserved_quantity" numeric(18,4) not null default '0', "fulfilled_quantity" numeric(18,4) not null default '0', "invoiced_quantity" numeric(18,4) not null default '0', "returned_quantity" numeric(18,4) not null default '0', "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "configuration" jsonb null, "promotion_code" text null, "promotion_snapshot" jsonb null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_order_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_order_lines_scope_idx" on "sales_order_lines" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_order_lines_status_idx" on "sales_order_lines" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_orders" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number" text not null, "external_reference" text null, "customer_reference" text null, "customer_entity_id" uuid null, "customer_contact_id" uuid null, "billing_address_id" uuid null, "shipping_address_id" uuid null, "currency_code" text not null, "exchange_rate" numeric(18,8) null, "status_entry_id" uuid null, "status" text null, "fulfillment_status_entry_id" uuid null, "fulfillment_status" text null, "payment_status_entry_id" uuid null, "payment_status" text null, "tax_strategy_key" text null, "discount_strategy_key" text null, "shipping_method_snapshot" jsonb null, "payment_method_snapshot" jsonb null, "placed_at" timestamptz(6) null, "expected_delivery_at" timestamptz(6) null, "due_at" timestamptz(6) null, "comments" text null, "internal_notes" text null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "shipping_net_amount" numeric(18,4) not null default '0', "shipping_gross_amount" numeric(18,4) not null default '0', "surcharge_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "paid_total_amount" numeric(18,4) not null default '0', "refunded_total_amount" numeric(18,4) not null default '0', "outstanding_amount" numeric(18,4) not null default '0', "line_item_count" int4 not null default 0, "metadata" jsonb null, "custom_field_set_id" uuid null, "channel_id" uuid null, "channel_ref_id" uuid null, "shipping_method_id" uuid null, "shipping_method_ref_id" uuid null, "delivery_window_id" uuid null, "delivery_window_ref_id" uuid null, "payment_method_id" uuid null, "payment_method_ref_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "customer_snapshot" jsonb null, "billing_address_snapshot" jsonb null, "shipping_address_snapshot" jsonb null, "tax_info" jsonb null, "delivery_window_snapshot" jsonb null, "shipping_method_code" text null, "delivery_window_code" text null, "payment_method_code" text null, "totals_snapshot" jsonb null, constraint "sales_orders_pkey" primary key ("id"));`);
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

    this.addSql(`create table "sales_quote_adjustments" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "quote_line_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "scope" text not null default 'order', "kind" text not null default 'custom', "code" text null, "label" text null, "calculator_key" text null, "promotion_id" uuid null, "rate" numeric(7,4) not null default '0', "amount_net" numeric(18,4) not null default '0', "amount_gross" numeric(18,4) not null default '0', "currency_code" text null, "metadata" jsonb null, "position" int4 not null default 0, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_quote_adjustments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_quote_adjustments_scope_idx" on "sales_quote_adjustments" ("quote_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_quote_lines" ("id" uuid not null default gen_random_uuid(), "quote_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "line_number" int4 not null default 0, "kind" text not null default 'product', "status_entry_id" uuid null, "status" text null, "product_id" uuid null, "product_variant_id" uuid null, "catalog_snapshot" jsonb null, "name" text null, "description" text null, "comment" text null, "quantity" numeric(18,4) not null default '0', "quantity_unit" text null, "currency_code" text not null, "unit_price_net" numeric(18,4) not null default '0', "unit_price_gross" numeric(18,4) not null default '0', "discount_amount" numeric(18,4) not null default '0', "discount_percent" numeric(7,4) not null default '0', "tax_rate" numeric(7,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "configuration" jsonb null, "promotion_code" text null, "promotion_snapshot" jsonb null, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "sales_quote_lines_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_quote_lines_scope_idx" on "sales_quote_lines" ("quote_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_quote_lines_status_idx" on "sales_quote_lines" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_quotes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_number" text not null, "status_entry_id" uuid null, "status" text null, "customer_entity_id" uuid null, "customer_contact_id" uuid null, "currency_code" text not null, "valid_from" timestamptz(6) null, "valid_until" timestamptz(6) null, "comments" text null, "subtotal_net_amount" numeric(18,4) not null default '0', "subtotal_gross_amount" numeric(18,4) not null default '0', "discount_total_amount" numeric(18,4) not null default '0', "tax_total_amount" numeric(18,4) not null default '0', "grand_total_net_amount" numeric(18,4) not null default '0', "grand_total_gross_amount" numeric(18,4) not null default '0', "line_item_count" int4 not null default 0, "metadata" jsonb null, "custom_field_set_id" uuid null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "converted_order_id" uuid null, "customer_snapshot" jsonb null, "billing_address_id" uuid null, "shipping_address_id" uuid null, "billing_address_snapshot" jsonb null, "shipping_address_snapshot" jsonb null, "tax_info" jsonb null, "shipping_method_id" uuid null, "shipping_method_code" text null, "shipping_method_ref_id" uuid null, "delivery_window_id" uuid null, "delivery_window_code" text null, "delivery_window_ref_id" uuid null, "payment_method_id" uuid null, "payment_method_code" text null, "payment_method_ref_id" uuid null, "shipping_method_snapshot" jsonb null, "delivery_window_snapshot" jsonb null, "payment_method_snapshot" jsonb null, "channel_id" uuid null, "channel_ref_id" uuid null, "external_reference" text null, "customer_reference" text null, "placed_at" timestamptz(6) null, "totals_snapshot" jsonb null, "acceptance_token" text null, "sent_at" timestamptz(6) null, constraint "sales_quotes_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_acceptance_token_unique" unique ("acceptance_token");`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_number_unique" unique ("organization_id", "tenant_id", "quote_number");`);
    this.addSql(`create index "sales_quotes_scope_idx" on "sales_quotes" ("organization_id", "tenant_id");`);
    this.addSql(`create index "sales_quotes_status_idx" on "sales_quotes" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number_format" text not null default 'ORDER-{yyyy}{mm}{dd}-{seq:5}', "quote_number_format" text not null default 'QUOTE-{yyyy}{mm}{dd}-{seq:5}', "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "order_customer_editable_statuses" jsonb null, "order_address_editable_statuses" jsonb null, constraint "sales_settings_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_settings" add constraint "sales_settings_scope_unique" unique ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_shipment_items" ("id" uuid not null default gen_random_uuid(), "shipment_id" uuid not null, "order_line_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "quantity" numeric(18,4) not null default '0', "metadata" jsonb null, constraint "sales_shipment_items_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_shipment_items_scope_idx" on "sales_shipment_items" ("shipment_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "sales_shipments" ("id" uuid not null default gen_random_uuid(), "order_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "shipment_number" text null, "shipping_method_id" uuid null, "status_entry_id" uuid null, "status" text null, "carrier_name" text null, "tracking_numbers" jsonb null, "shipped_at" timestamptz(6) null, "delivered_at" timestamptz(6) null, "weight_value" numeric(16,4) null, "weight_unit" text null, "declared_value_net" numeric(18,4) null, "declared_value_gross" numeric(18,4) null, "currency_code" text null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "items_snapshot" jsonb null, constraint "sales_shipments_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_shipments_scope_idx" on "sales_shipments" ("order_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "sales_shipments_status_idx" on "sales_shipments" ("organization_id", "tenant_id", "status");`);

    this.addSql(`create table "sales_shipping_methods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "description" text null, "carrier_code" text null, "service_level" text null, "estimated_transit_days" int4 null, "base_rate_net" numeric(16,4) not null default '0', "base_rate_gross" numeric(16,4) not null default '0', "currency_code" text null, "is_active" bool not null default true, "metadata" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "provider_key" text null, constraint "sales_shipping_methods_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_shipping_methods" add constraint "sales_shipping_methods_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_shipping_methods_scope_idx" on "sales_shipping_methods" ("organization_id", "tenant_id");`);

    this.addSql(`create table "sales_tax_rates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "code" text not null, "rate" numeric(7,4) not null, "country_code" text null, "region_code" text null, "postal_code" text null, "city" text null, "customer_group_id" uuid null, "product_category_id" uuid null, "channel_id" uuid null, "priority" int4 not null default 0, "is_compound" bool not null default false, "metadata" jsonb null, "starts_at" timestamptz(6) null, "ends_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "is_default" bool not null default false, constraint "sales_tax_rates_pkey" primary key ("id"));`);
    this.addSql(`alter table "sales_tax_rates" add constraint "sales_tax_rates_code_unique" unique ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "sales_tax_rates_scope_idx" on "sales_tax_rates" ("organization_id", "tenant_id");`);

    this.addSql(`create table "scheduled_jobs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid null, "scope_type" text not null default 'tenant', "name" text not null, "description" text null, "schedule_type" text not null, "schedule_value" text not null, "timezone" text not null default 'UTC', "target_type" text not null, "target_queue" text null, "target_command" text null, "target_payload" jsonb null, "require_feature" text null, "is_enabled" bool not null default true, "last_run_at" timestamptz(6) null, "next_run_at" timestamptz(6) null, "source_type" text not null default 'user', "source_module" text null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), "deleted_at" timestamptz(6) null, "created_by_user_id" uuid null, "updated_by_user_id" uuid null, constraint "scheduled_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index "scheduled_jobs_next_run_idx" on "scheduled_jobs" ("next_run_at");`);
    this.addSql(`create index "scheduled_jobs_org_tenant_idx" on "scheduled_jobs" ("organization_id", "tenant_id");`);
    this.addSql(`create index "scheduled_jobs_scope_idx" on "scheduled_jobs" ("scope_type", "is_enabled");`);

    this.addSql(`create table "search_tokens" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field" text not null, "token_hash" text not null, "token" text null, "created_at" timestamptz(6) not null, constraint "search_tokens_pkey" primary key ("id"));`);
    this.addSql(`create index "search_tokens_entity_idx" on "search_tokens" ("entity_type", "entity_id");`);
    this.addSql(`create index "search_tokens_lookup_idx" on "search_tokens" ("entity_type", "field", "token_hash", "tenant_id", "organization_id");`);

    this.addSql(`create table "sessions" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "token" text not null, "expires_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, "last_used_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "sessions_pkey" primary key ("id"));`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_unique" unique ("token");`);

    this.addSql(`create table "staff_leave_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "member_id" uuid not null, "start_date" timestamptz(6) not null, "end_date" timestamptz(6) not null, "timezone" text not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "unavailability_reason_entry_id" uuid null, "unavailability_reason_value" text null, "note" text null, "decision_comment" text null, "submitted_by_user_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "staff_leave_requests_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_leave_requests_member_idx" on "staff_leave_requests" ("member_id");`);
    this.addSql(`create index "staff_leave_requests_status_idx" on "staff_leave_requests" ("status", "tenant_id", "organization_id");`);
    this.addSql(`create index "staff_leave_requests_tenant_org_idx" on "staff_leave_requests" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_activities" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "activity_type" text not null, "subject" text null, "body" text null, "occurred_at" timestamptz(6) null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "member_id" uuid not null, constraint "staff_team_member_activities_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_activities_member_idx" on "staff_team_member_activities" ("member_id");`);
    this.addSql(`create index "staff_team_member_activities_member_occurred_created_idx" on "staff_team_member_activities" ("member_id", "occurred_at", "created_at");`);
    this.addSql(`create index "staff_team_member_activities_tenant_org_idx" on "staff_team_member_activities" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_addresses" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text null, "purpose" text null, "company_name" text null, "address_line1" text not null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "building_number" text null, "flat_number" text null, "latitude" float4 null, "longitude" float4 null, "is_primary" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "member_id" uuid not null, constraint "staff_team_member_addresses_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_addresses_member_idx" on "staff_team_member_addresses" ("member_id");`);
    this.addSql(`create index "staff_team_member_addresses_tenant_org_idx" on "staff_team_member_addresses" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_comments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "body" text not null, "author_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "member_id" uuid not null, constraint "staff_team_member_comments_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_comments_member_idx" on "staff_team_member_comments" ("member_id");`);
    this.addSql(`create index "staff_team_member_comments_tenant_org_idx" on "staff_team_member_comments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_member_job_histories" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "company_name" text null, "description" text null, "start_date" timestamptz(6) not null, "end_date" timestamptz(6) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "member_id" uuid not null, constraint "staff_team_member_job_histories_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_member_job_histories_member_idx" on "staff_team_member_job_histories" ("member_id");`);
    this.addSql(`create index "staff_team_member_job_histories_member_start_idx" on "staff_team_member_job_histories" ("member_id", "start_date");`);
    this.addSql(`create index "staff_team_member_job_histories_tenant_org_idx" on "staff_team_member_job_histories" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "team_id" uuid null, "display_name" text not null, "description" text null, "user_id" uuid null, "role_ids" jsonb not null default '[]', "tags" jsonb not null default '[]', "availability_rule_set_id" uuid null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "staff_team_members_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_members_tenant_org_idx" on "staff_team_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_team_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "team_id" uuid null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "staff_team_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_team_roles_tenant_org_idx" on "staff_team_roles" ("tenant_id", "organization_id");`);

    this.addSql(`create table "staff_teams" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "staff_teams_pkey" primary key ("id"));`);
    this.addSql(`create index "staff_teams_tenant_org_idx" on "staff_teams" ("tenant_id", "organization_id");`);

    this.addSql(`create table "step_instances" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "step_id" varchar(100) not null, "step_name" varchar(255) not null, "step_type" varchar(50) not null, "status" varchar(20) not null, "input_data" jsonb null, "output_data" jsonb null, "error_data" jsonb null, "entered_at" timestamptz(6) null, "exited_at" timestamptz(6) null, "execution_time_ms" int4 null, "retry_count" int4 not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "step_instances_pkey" primary key ("id"));`);
    this.addSql(`create index "step_instances_step_id_idx" on "step_instances" ("step_id", "status");`);
    this.addSql(`create index "step_instances_tenant_org_idx" on "step_instances" ("tenant_id", "organization_id");`);
    this.addSql(`create index "step_instances_workflow_instance_idx" on "step_instances" ("workflow_instance_id", "status");`);

    this.addSql(`create table "tenants" ("id" uuid not null default gen_random_uuid(), "name" text not null, "is_active" bool not null default true, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "tenants_pkey" primary key ("id"));`);

    this.addSql(`create table "todos" ("id" uuid not null default gen_random_uuid(), "title" text not null, "tenant_id" uuid null, "organization_id" uuid null, "is_done" bool not null default false, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "todos_pkey" primary key ("id"));`);

    this.addSql(`create table "upgrade_action_runs" ("id" uuid not null default gen_random_uuid(), "version" text not null, "action_id" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "completed_at" timestamptz(6) not null, "created_at" timestamptz(6) not null, constraint "upgrade_action_runs_pkey" primary key ("id"));`);
    this.addSql(`alter table "upgrade_action_runs" add constraint "upgrade_action_runs_action_scope_unique" unique ("version", "action_id", "organization_id", "tenant_id");`);
    this.addSql(`create index "upgrade_action_runs_scope_idx" on "upgrade_action_runs" ("organization_id", "tenant_id");`);

    this.addSql(`create table "user_acls" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid not null, "features_json" jsonb null, "is_super_admin" bool not null default false, "organizations_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "user_acls_pkey" primary key ("id"));`);

    this.addSql(`create table "user_roles" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "role_id" uuid not null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "user_roles_pkey" primary key ("id"));`);

    this.addSql(`create table "user_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) null, "deleted_at" timestamptz(6) null, constraint "user_sidebar_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_tenant_id_organi_f3f2f_unique" unique ("user_id", "tenant_id", "organization_id", "locale");`);

    this.addSql(`create table "user_tasks" ("id" uuid not null default gen_random_uuid(), "workflow_instance_id" uuid not null, "step_instance_id" uuid not null, "task_name" varchar(255) not null, "description" text null, "status" varchar(20) not null, "form_schema" jsonb null, "form_data" jsonb null, "assigned_to" varchar(255) null, "assigned_to_roles" text[] null, "claimed_by" varchar(255) null, "claimed_at" timestamptz(6) null, "due_date" timestamptz(6) null, "escalated_at" timestamptz(6) null, "escalated_to" varchar(255) null, "completed_by" varchar(255) null, "completed_at" timestamptz(6) null, "comments" text null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, constraint "user_tasks_pkey" primary key ("id"));`);
    this.addSql(`create index "user_tasks_status_assigned_idx" on "user_tasks" ("status", "assigned_to");`);
    this.addSql(`create index "user_tasks_status_due_date_idx" on "user_tasks" ("status", "due_date");`);
    this.addSql(`create index "user_tasks_tenant_org_idx" on "user_tasks" ("tenant_id", "organization_id");`);
    this.addSql(`create index "user_tasks_workflow_instance_idx" on "user_tasks" ("workflow_instance_id");`);

    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "email" text not null, "name" text null, "password_hash" text null, "is_confirmed" bool not null default true, "last_login_at" timestamptz(6) null, "created_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "email_hash" text null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`create index "users_email_hash_idx" on "users" ("email_hash");`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "vector_search" ("id" uuid not null default gen_random_uuid(), "driver_id" text not null, "entity_id" text not null, "record_id" text not null, "tenant_id" uuid not null, "organization_id" uuid null, "checksum" text not null, "embedding" vector(1536) not null, "url" text null, "presenter" jsonb null, "links" jsonb null, "payload" jsonb null, "result_title" text null, "result_subtitle" text null, "result_icon" text null, "result_badge" text null, "result_snapshot" text null, "primary_link_href" text null, "primary_link_label" text null, "created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), constraint "vector_search_pkey" primary key ("id"));`);
    this.addSql(`create index "vector_search_embedding_idx" on "vector_search" ("embedding");`);
    this.addSql(`create index "vector_search_lookup" on "vector_search" ("tenant_id", "organization_id", "entity_id");`);
    this.addSql(`alter table "vector_search" add constraint "vector_search_uniq" unique ("driver_id", "entity_id", "record_id", "tenant_id");`);

    this.addSql(`create table "vector_search_migrations" ("id" text not null, "applied_at" timestamptz(6) not null default now(), constraint "vector_search_migrations_pkey" primary key ("id"));`);

    this.addSql(`create table "workflow_definitions" ("id" uuid not null default gen_random_uuid(), "workflow_id" varchar(100) not null, "workflow_name" varchar(255) not null, "description" text null, "version" int4 not null default 1, "definition" jsonb not null, "metadata" jsonb null, "enabled" bool not null default true, "effective_from" timestamptz(6) null, "effective_to" timestamptz(6) null, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(255) null, "updated_by" varchar(255) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "workflow_definitions_pkey" primary key ("id"));`);
    this.addSql(`create index "workflow_definitions_enabled_idx" on "workflow_definitions" ("enabled");`);
    this.addSql(`create index "workflow_definitions_tenant_org_idx" on "workflow_definitions" ("tenant_id", "organization_id");`);
    this.addSql(`create index "workflow_definitions_workflow_id_idx" on "workflow_definitions" ("workflow_id");`);
    this.addSql(`alter table "workflow_definitions" add constraint "workflow_definitions_workflow_id_tenant_id_unique" unique ("workflow_id", "tenant_id");`);

    this.addSql(`create table "workflow_event_triggers" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "description" text null, "workflow_definition_id" uuid not null, "event_pattern" varchar(255) not null, "config" jsonb null, "enabled" bool not null default true, "priority" int4 not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(255) null, "updated_by" varchar(255) null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, constraint "workflow_event_triggers_pkey" primary key ("id"));`);
    this.addSql(`create index "workflow_event_triggers_definition_idx" on "workflow_event_triggers" ("workflow_definition_id");`);
    this.addSql(`create index "workflow_event_triggers_enabled_priority_idx" on "workflow_event_triggers" ("enabled", "priority");`);
    this.addSql(`create index "workflow_event_triggers_event_pattern_idx" on "workflow_event_triggers" ("event_pattern", "enabled");`);
    this.addSql(`create index "workflow_event_triggers_tenant_org_idx" on "workflow_event_triggers" ("tenant_id", "organization_id");`);

    this.addSql(`create table "workflow_events" ("id" bigserial primary key, "workflow_instance_id" uuid not null, "step_instance_id" uuid null, "event_type" varchar(50) not null, "event_data" jsonb not null, "occurred_at" timestamptz(6) not null, "user_id" varchar(255) null, "tenant_id" uuid not null, "organization_id" uuid not null);`);
    this.addSql(`create index "workflow_events_event_type_idx" on "workflow_events" ("event_type", "occurred_at");`);
    this.addSql(`create index "workflow_events_instance_occurred_idx" on "workflow_events" ("workflow_instance_id", "occurred_at");`);
    this.addSql(`create index "workflow_events_tenant_org_idx" on "workflow_events" ("tenant_id", "organization_id");`);

    this.addSql(`create table "workflow_instances" ("id" uuid not null default gen_random_uuid(), "definition_id" uuid not null, "workflow_id" varchar(100) not null, "version" int4 not null, "status" varchar(30) not null, "current_step_id" varchar(100) not null, "context" jsonb not null, "correlation_key" varchar(255) null, "metadata" jsonb null, "started_at" timestamptz(6) not null, "completed_at" timestamptz(6) null, "paused_at" timestamptz(6) null, "cancelled_at" timestamptz(6) null, "error_message" text null, "error_details" jsonb null, "retry_count" int4 not null default 0, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "deleted_at" timestamptz(6) null, "pending_transition" jsonb null, constraint "workflow_instances_pkey" primary key ("id"));`);
    this.addSql(`create index "workflow_instances_correlation_key_idx" on "workflow_instances" ("correlation_key");`);
    this.addSql(`create index "workflow_instances_current_step_idx" on "workflow_instances" ("current_step_id", "status");`);
    this.addSql(`create index "workflow_instances_definition_status_idx" on "workflow_instances" ("definition_id", "status");`);
    this.addSql(`create index "workflow_instances_status_tenant_idx" on "workflow_instances" ("status", "tenant_id");`);
    this.addSql(`create index "workflow_instances_tenant_org_idx" on "workflow_instances" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_category_id_foreign" foreign key ("category_id") references "catalog_product_categories" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_category_assignments" add constraint "catalog_product_category_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_offers" add constraint "catalog_product_offers_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_options" add constraint "catalog_product_options_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_child_product_id_foreign" foreign key ("child_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_relations" add constraint "catalog_product_relations_parent_product_id_foreign" foreign key ("parent_product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_tag_assignments" add constraint "catalog_product_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "catalog_product_tags" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_variant_option_values" add constraint "catalog_product_variant_option_values_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_offer_id_foreign" foreign key ("offer_id") references "catalog_product_offers" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_price_kind_id_foreign" foreign key ("price_kind_id") references "catalog_price_kinds" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "catalog_product_variant_prices" add constraint "catalog_product_variant_prices_variant_id_foreign" foreign key ("variant_id") references "catalog_product_variants" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_child_variant_id_foreign" foreign key ("child_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "catalog_product_variant_relations" add constraint "catalog_product_variant_relations_parent_variant_id_foreign" foreign key ("parent_variant_id") references "catalog_product_variants" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "catalog_product_variants" add constraint "catalog_product_variants_product_id_foreign" foreign key ("product_id") references "catalog_products" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "catalog_products" add constraint "catalog_products_option_schema_id_foreign" foreign key ("option_schema_id") references "catalog_product_option_schemas" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "customer_activities" add constraint "customer_activities_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "customer_activities" add constraint "customer_activities_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_addresses" add constraint "customer_addresses_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_comments" add constraint "customer_comments_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "customer_comments" add constraint "customer_comments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_companies" add constraint "customer_companies_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_people" add constraint "customer_people_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "customer_people" add constraint "customer_people_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "customer_tags" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "customer_todo_links" add constraint "customer_todo_links_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "dictionary_entries" add constraint "dictionary_entries_dictionary_id_foreign" foreign key ("dictionary_id") references "dictionaries" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "feature_toggle_audit_logs" add constraint "feature_toggle_audit_logs_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "feature_toggle_overrides" add constraint "feature_toggle_overrides_toggle_id_foreign" foreign key ("toggle_id") references "feature_toggles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "organizations" add constraint "organizations_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "password_resets" add constraint "password_resets_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "resources_resource_activities" add constraint "resources_resource_activities_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "resources_resource_comments" add constraint "resources_resource_comments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_resource_id_foreign" foreign key ("resource_id") references "resources_resources" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "resources_resource_tag_assignments" add constraint "resources_resource_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "resources_resource_tags" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "role_acls" add constraint "role_acls_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "rule_execution_logs" add constraint "rule_execution_logs_rule_id_foreign" foreign key ("rule_id") references "business_rules" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_id_foreign" foreign key ("rule_id") references "business_rules" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_set_id_foreign" foreign key ("rule_set_id") references "rule_sets" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_credit_memo_lines" add constraint "sales_credit_memo_lines_credit_memo_id_foreign" foreign key ("credit_memo_id") references "sales_credit_memos" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_credit_memo_lines" add constraint "sales_credit_memo_lines_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_credit_memos" add constraint "sales_credit_memos_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_credit_memos" add constraint "sales_credit_memos_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_addresses" add constraint "sales_document_addresses_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_document_tag_assignments" add constraint "sales_document_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "sales_document_tags" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_invoice_lines" add constraint "sales_invoice_lines_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_invoice_lines" add constraint "sales_invoice_lines_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_invoices" add constraint "sales_invoices_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_notes" add constraint "sales_notes_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_notes" add constraint "sales_notes_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_order_adjustments" add constraint "sales_order_adjustments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_order_adjustments" add constraint "sales_order_adjustments_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_order_lines" add constraint "sales_order_lines_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_orders" add constraint "sales_orders_channel_ref_id_foreign" foreign key ("channel_ref_id") references "sales_channels" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_delivery_window_ref_id_foreign" foreign key ("delivery_window_ref_id") references "sales_delivery_windows" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_payment_method_ref_id_foreign" foreign key ("payment_method_ref_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_orders" add constraint "sales_orders_shipping_method_ref_id_foreign" foreign key ("shipping_method_ref_id") references "sales_shipping_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_payment_allocations" add constraint "sales_payment_allocations_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_payment_allocations" add constraint "sales_payment_allocations_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_payment_allocations" add constraint "sales_payment_allocations_payment_id_foreign" foreign key ("payment_id") references "sales_payments" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_payments" add constraint "sales_payments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_payments" add constraint "sales_payments_payment_method_id_foreign" foreign key ("payment_method_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_quote_adjustments" add constraint "sales_quote_adjustments_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_quote_adjustments" add constraint "sales_quote_adjustments_quote_line_id_foreign" foreign key ("quote_line_id") references "sales_quote_lines" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_quote_lines" add constraint "sales_quote_lines_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_channel_ref_id_foreign" foreign key ("channel_ref_id") references "sales_channels" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_delivery_window_ref_id_foreign" foreign key ("delivery_window_ref_id") references "sales_delivery_windows" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_payment_method_ref_id_foreign" foreign key ("payment_method_ref_id") references "sales_payment_methods" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_quotes" add constraint "sales_quotes_shipping_method_ref_id_foreign" foreign key ("shipping_method_ref_id") references "sales_shipping_methods" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "sales_shipment_items" add constraint "sales_shipment_items_order_line_id_foreign" foreign key ("order_line_id") references "sales_order_lines" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "sales_shipment_items" add constraint "sales_shipment_items_shipment_id_foreign" foreign key ("shipment_id") references "sales_shipments" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sales_shipments" add constraint "sales_shipments_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "sessions" add constraint "sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_leave_requests" add constraint "staff_leave_requests_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_activities" add constraint "staff_team_member_activities_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_addresses" add constraint "staff_team_member_addresses_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_comments" add constraint "staff_team_member_comments_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "staff_team_member_job_histories" add constraint "staff_team_member_job_histories_member_id_foreign" foreign key ("member_id") references "staff_team_members" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_acls" add constraint "user_acls_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_roles" add constraint "user_roles_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_roles" add constraint "user_roles_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "entity_translations" alter column "translations" type jsonb using ("translations"::jsonb);`);
    this.addSql(`alter table "entity_translations" alter column "translations" set default '{}';`);
    this.addSql(`alter table "entity_translations" alter column "created_at" type timestamptz(6) using ("created_at"::timestamptz(6));`);
    this.addSql(`alter table "entity_translations" alter column "created_at" set default now();`);
    this.addSql(`alter table "entity_translations" alter column "updated_at" type timestamptz(6) using ("updated_at"::timestamptz(6));`);
    this.addSql(`alter table "entity_translations" alter column "updated_at" set default now();`);
    this.addSql(`CREATE UNIQUE INDEX entity_translations_scope_uq ON public.entity_translations USING btree (entity_type, entity_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));`);
  }

}
