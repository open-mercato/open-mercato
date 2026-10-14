import { Migration } from '@mikro-orm/migrations';

export class Migration20261014231017_cart extends Migration {

  override name = 'Migration20261014231017';

  override up(): void | Promise<void> {
    this.addSql(`create table "carts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "token_hash" text not null, "store_id" uuid null, "channel" text not null, "kind" text not null default 'basket', "proposed_to_cart_id" uuid null, "sales_channel_id" uuid null, "status" text not null default 'active', "currency_code" text not null, "locale" text not null, "customer_id" uuid null, "customer_ids" jsonb null, "customer_user_id" uuid null, "customer_group_ids" jsonb not null default '[]', "price_kind_id" uuid null, "tax_mode" text not null, "email" text null, "buyer_digest" text not null, "assortment_scope_hash" text null, "totals" jsonb not null, "totals_computed_at" timestamptz not null, "promotion_effects" jsonb null, "requires_approval" boolean not null default false, "approval_id" uuid null, "note" text null, "metadata" jsonb null, "merged_into_cart_id" uuid null, "last_activity_at" timestamptz not null, "last_price_change_at" timestamptz null, "locked_at" timestamptz null, "lock_expires_at" timestamptz null, "checkout_session_id" text null, "resolved_at" timestamptz null, "expires_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "carts_proposed_to_cart_status_idx" on "carts" ("tenant_id", "proposed_to_cart_id", "status") where "kind" = 'proposal';`);
    this.addSql(`create index "carts_tenant_status_resolved_idx" on "carts" ("tenant_id", "status", "resolved_at");`);
    this.addSql(`create index "carts_tenant_status_activity_idx" on "carts" ("tenant_id", "status", "last_activity_at");`);
    this.addSql(`create index "carts_tenant_status_expires_idx" on "carts" ("tenant_id", "status", "expires_at");`);
    this.addSql(`create index "carts_tenant_customer_status_idx" on "carts" ("tenant_id", "customer_id", "status");`);
    this.addSql(`create index "carts_tenant_org_idx" on "carts" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "carts" add constraint "carts_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "cart_idempotency_keys" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "cart_id" uuid not null, "key" text not null, "request_digest" text not null, "response_status" int not null, "response_body" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cart_idempotency_keys_tenant_org_idx" on "cart_idempotency_keys" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "cart_idempotency_keys" add constraint "cart_idempotency_keys_cart_id_key_unique" unique ("cart_id", "key");`);

    this.addSql(`create table "cart_lines" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "cart_id" uuid not null, "line_number" int not null, "product_id" uuid not null, "variant_id" uuid null, "sku" text null, "name" text not null, "option_values" jsonb null, "quantity" numeric(16,4) not null, "quantity_unit" text null, "uom_snapshot" jsonb null, "unit_price_net" numeric(16,4) null, "unit_price_gross" numeric(16,4) null, "tax_rate" numeric(7,4) null, "price_kind_id" uuid null, "price_row_id" uuid null, "price_tier_min_quantity" int null, "priced_at" timestamptz not null, "line_totals" jsonb not null, "discount_total_net" numeric(16,4) null, "promotion_id" uuid null, "origin" text not null default 'customer', "flag_state" text null, "configuration" jsonb null, "configuration_hash" text generated always as (md5(configuration::text)) stored null, "added_by_actor_type" text not null, "added_by_actor_id" uuid null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "cart_lines_unique_line_key" on "cart_lines" ("cart_id", "product_id", "variant_id", "configuration_hash", "promotion_id") nulls not distinct where "deleted_at" is null;`);
    this.addSql(`create index "cart_lines_cart_idx" on "cart_lines" ("cart_id");`);
    this.addSql(`create index "cart_lines_tenant_org_idx" on "cart_lines" ("tenant_id", "organization_id");`);

    this.addSql(`create table "cart_merge_logs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source_cart_id" uuid not null, "target_cart_id" uuid not null, "strategy" text not null, "source_snapshot" jsonb not null, "outcome" jsonb not null, "merged_by_actor_type" text not null, "merged_by_actor_id" uuid null, "proposal_cart_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cart_merge_logs_target_idx" on "cart_merge_logs" ("target_cart_id");`);
    this.addSql(`create index "cart_merge_logs_source_idx" on "cart_merge_logs" ("source_cart_id");`);
    this.addSql(`create index "cart_merge_logs_tenant_org_idx" on "cart_merge_logs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "cart_promotion_applications" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "cart_id" uuid not null, "promotion_id" uuid not null, "code" text null, "code_id" uuid null, "code_type" text null, "code_reservation_id" uuid null, "scope" text not null, "cart_line_id" uuid null, "effect" jsonb not null, "amount_net" numeric(16,4) null, "amount_gross" numeric(16,4) null, "applied_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cart_promotion_applications_cart_idx" on "cart_promotion_applications" ("cart_id");`);
    this.addSql(`create index "cart_promotion_applications_tenant_org_idx" on "cart_promotion_applications" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "carts" add constraint "carts_proposed_to_cart_id_foreign" foreign key ("proposed_to_cart_id") references "carts" ("id") on delete restrict;`);
    this.addSql(`alter table "carts" add constraint "carts_merged_into_cart_id_foreign" foreign key ("merged_into_cart_id") references "carts" ("id") on delete set null;`);

    this.addSql(`alter table "cart_idempotency_keys" add constraint "cart_idempotency_keys_cart_id_foreign" foreign key ("cart_id") references "carts" ("id") on delete cascade;`);

    this.addSql(`alter table "cart_lines" add constraint "cart_lines_cart_id_foreign" foreign key ("cart_id") references "carts" ("id") on delete cascade;`);

    this.addSql(`alter table "cart_merge_logs" add constraint "cart_merge_logs_source_cart_id_foreign" foreign key ("source_cart_id") references "carts" ("id") on delete restrict;`);
    this.addSql(`alter table "cart_merge_logs" add constraint "cart_merge_logs_target_cart_id_foreign" foreign key ("target_cart_id") references "carts" ("id") on delete restrict;`);
    this.addSql(`alter table "cart_merge_logs" add constraint "cart_merge_logs_proposal_cart_id_foreign" foreign key ("proposal_cart_id") references "carts" ("id") on delete restrict;`);

    this.addSql(`alter table "cart_promotion_applications" add constraint "cart_promotion_applications_cart_id_foreign" foreign key ("cart_id") references "carts" ("id") on delete cascade;`);
    this.addSql(`alter table "cart_promotion_applications" add constraint "cart_promotion_applications_cart_line_id_foreign" foreign key ("cart_line_id") references "cart_lines" ("id") on delete set null;`);

    // Hand-authored (coding-agent exception, root AGENTS.md "Entity Schema And Migration
    // Workflow"): §4.1 "Check constraint: NOT NULL exactly when kind = 'proposal', NULL
    // otherwise" has no MikroORM decorator equivalent — unlike the generated-column and
    // NULLS NOT DISTINCT pieces above, which the generator already produced declaratively
    // from `data/entities.ts`.
    this.addSql(`alter table "carts" add constraint "carts_proposed_to_cart_id_kind_check" check (("kind" = 'proposal' and "proposed_to_cart_id" is not null) or ("kind" <> 'proposal' and "proposed_to_cart_id" is null));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "cart_idempotency_keys" cascade;`);
    this.addSql(`drop table if exists "cart_lines" cascade;`);
    this.addSql(`drop table if exists "cart_merge_logs" cascade;`);
    this.addSql(`drop table if exists "cart_promotion_applications" cascade;`);
    this.addSql(`drop table if exists "carts" cascade;`);
  }

}
