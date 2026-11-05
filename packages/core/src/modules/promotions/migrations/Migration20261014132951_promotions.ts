import { Migration } from '@mikro-orm/migrations';

export class Migration20261014132951_promotions extends Migration {

  override name = 'Migration20261014132951';

  override up(): void | Promise<void> {
    this.addSql(`create table "promotion_codes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "type" text not null, "code" text null, "prefix" text null, "suffix" text null, "length" int null, "amount" int null, "generated" int not null default 0, "used" int not null default 0, "usage" text not null, "usage_amount" int null, "usage_per_customer" int null, "active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "promotion_codes_tenant_org_code_unique" on "promotion_codes" ("tenant_id", "organization_id", "code") where "code" is not null and "deleted_at" is null;`);
    this.addSql(`create index "promotion_codes_tenant_org_idx" on "promotion_codes" ("tenant_id", "organization_id");`);

    this.addSql(`create table "promotion_code_reservations" ("id" uuid not null default gen_random_uuid(), "code_id" uuid not null, "code_string" text not null, "cart_id" uuid not null, "customer_id" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "expires_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "promotion_code_reservations_expires_idx" on "promotion_code_reservations" ("expires_at");`);
    this.addSql(`create index "promotion_code_reservations_tenant_org_idx" on "promotion_code_reservations" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "promotion_code_reservations" add constraint "promotion_code_reservations_code_id_cart_id_unique" unique ("code_id", "cart_id");`);
    this.addSql(`create unique index "promotion_code_reservations_code_customer_unique" on "promotion_code_reservations" ("code_id", "customer_id") where "customer_id" is not null;`);

    this.addSql(`create table "promotion_code_usages" ("id" uuid not null default gen_random_uuid(), "code_id" uuid not null, "customer_id" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "used_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "promotion_code_usages_code_idx" on "promotion_code_usages" ("code_id");`);
    this.addSql(`create index "promotion_code_usages_tenant_org_idx" on "promotion_code_usages" ("tenant_id", "organization_id");`);

    this.addSql(`create table "promotion_generated_codes" ("id" uuid not null default gen_random_uuid(), "code_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "promotion_generated_codes_tenant_org_idx" on "promotion_generated_codes" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "promotion_generated_codes" add constraint "promotion_generated_codes_tenant_id_organization_id_code_unique" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`create table "promotions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "description" text null, "order" int not null, "active" boolean not null default false, "starts_at" timestamptz null, "ends_at" timestamptz null, "cumulative" boolean not null default true, "tags" text[] not null, "excluded_tags" text[] not null, "exclude_flags" jsonb not null, "eligible_currencies" text[] not null, "max_budget" numeric(16,2) null, "budget_currency" text null, "rule_group_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "promotions_active_order_idx" on "promotions" ("tenant_id", "organization_id", "active", "order");`);
    this.addSql(`create index "promotions_tenant_org_idx" on "promotions" ("tenant_id", "organization_id");`);

    this.addSql(`create table "promotion_rule_groups" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "promotion_id" uuid not null, "parent_rule_group_id" uuid null, "operator" text not null, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "promotion_rule_groups_tenant_org_idx" on "promotion_rule_groups" ("tenant_id", "organization_id");`);
    this.addSql(`create index "promotion_rule_groups_parent_idx" on "promotion_rule_groups" ("parent_rule_group_id");`);
    this.addSql(`create index "promotion_rule_groups_promotion_idx" on "promotion_rule_groups" ("promotion_id");`);

    this.addSql(`create table "promotion_rules" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "rule_group_id" uuid not null, "promotion_id" uuid not null, "rule_type" text not null, "config" jsonb not null, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "promotion_rules_tenant_org_idx" on "promotion_rules" ("tenant_id", "organization_id");`);
    this.addSql(`create index "promotion_rules_promotion_idx" on "promotion_rules" ("promotion_id");`);
    this.addSql(`create index "promotion_rules_rule_group_idx" on "promotion_rules" ("rule_group_id");`);

    this.addSql(`create table "promotion_usages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "promotion_id" uuid not null, "order_id" text not null, "order_type" text not null, "customer_id" text null, "currency" text not null, "total_discount_amount" numeric(16,2) not null, "effects_snapshot" jsonb not null, "registered_at" timestamptz not null, "reverted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "promotion_usages_budget_idx" on "promotion_usages" ("promotion_id", "organization_id", "tenant_id", "currency", "reverted_at");`);
    this.addSql(`alter table "promotion_usages" add constraint "promotion_usages_promotion_id_order_id_organizati_b672c_unique" unique ("promotion_id", "order_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "promotion_benefits" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "rule_group_id" uuid not null, "promotion_id" uuid not null, "benefit_type" text not null, "applies_to" text not null, "config" jsonb not null, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "promotion_benefits_tenant_org_idx" on "promotion_benefits" ("tenant_id", "organization_id");`);
    this.addSql(`create index "promotion_benefits_promotion_idx" on "promotion_benefits" ("promotion_id");`);
    this.addSql(`create index "promotion_benefits_rule_group_idx" on "promotion_benefits" ("rule_group_id");`);

    this.addSql(`alter table "promotion_code_reservations" add constraint "promotion_code_reservations_code_id_foreign" foreign key ("code_id") references "promotion_codes" ("id") on delete cascade;`);

    this.addSql(`alter table "promotion_code_usages" add constraint "promotion_code_usages_code_id_foreign" foreign key ("code_id") references "promotion_codes" ("id") on delete cascade;`);

    this.addSql(`alter table "promotion_generated_codes" add constraint "promotion_generated_codes_code_id_foreign" foreign key ("code_id") references "promotion_codes" ("id") on delete cascade;`);

    this.addSql(`alter table "promotions" add constraint "promotions_rule_group_id_foreign" foreign key ("rule_group_id") references "promotion_rule_groups" ("id") on delete set null;`);

    this.addSql(`alter table "promotion_rule_groups" add constraint "promotion_rule_groups_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on delete cascade;`);
    this.addSql(`alter table "promotion_rule_groups" add constraint "promotion_rule_groups_parent_rule_group_id_foreign" foreign key ("parent_rule_group_id") references "promotion_rule_groups" ("id") on delete cascade;`);

    this.addSql(`alter table "promotion_rules" add constraint "promotion_rules_rule_group_id_foreign" foreign key ("rule_group_id") references "promotion_rule_groups" ("id") on delete cascade;`);
    this.addSql(`alter table "promotion_rules" add constraint "promotion_rules_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on delete cascade;`);

    this.addSql(`alter table "promotion_usages" add constraint "promotion_usages_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on delete restrict;`);

    this.addSql(`alter table "promotion_benefits" add constraint "promotion_benefits_rule_group_id_foreign" foreign key ("rule_group_id") references "promotion_rule_groups" ("id") on delete cascade;`);
    this.addSql(`alter table "promotion_benefits" add constraint "promotion_benefits_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on delete cascade;`);
  }

  // Hand-authored (coding-agent exception, root AGENTS.md "Entity Schema And Migration
  // Workflow"): the generator left `down()` empty here — the `promotions` <->
  // `promotion_rule_groups` circular FK (§Data Models rev W5a) appears to break its
  // down-diff dependency sort, unlike every other migration in this codebase. `cascade`
  // on each drop removes the cross-referencing FK constraints regardless of order, so
  // explicit constraint drops are not needed first.
  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "promotion_benefits" cascade;`);
    this.addSql(`drop table if exists "promotion_usages" cascade;`);
    this.addSql(`drop table if exists "promotion_rules" cascade;`);
    this.addSql(`drop table if exists "promotion_rule_groups" cascade;`);
    this.addSql(`drop table if exists "promotions" cascade;`);
    this.addSql(`drop table if exists "promotion_generated_codes" cascade;`);
    this.addSql(`drop table if exists "promotion_code_usages" cascade;`);
    this.addSql(`drop table if exists "promotion_code_reservations" cascade;`);
    this.addSql(`drop table if exists "promotion_codes" cascade;`);
  }

}
