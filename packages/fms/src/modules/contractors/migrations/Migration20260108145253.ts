import { Migration } from '@mikro-orm/migrations';

export class Migration20260108145253_contractors extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "contractors" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" text not null, "short_name" text null, "code" text null, "parent_id" uuid null, "tax_id" text null, "legal_name" text null, "registration_number" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "contractors_pkey" primary key ("id"));`);
    this.addSql(`create index "contractors_parent_idx" on "contractors" ("parent_id");`);
    this.addSql(`create index "idx_contractors_tenant_org_id" on "contractors" ("tenant_id", "organization_id", "id") where deleted_at is null;`);
    this.addSql(`create index "contractors_org_tenant_idx" on "contractors" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index "contractors_code_unique" on "contractors" ("tenant_id", "organization_id", "code") where deleted_at is null and code is not null;`);

    this.addSql(`create table "contractor_addresses" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "purpose" text not null, "label" text null, "address_line1" text not null, "address_line2" text null, "city" text not null, "state" text null, "postal_code" text null, "country_code" text not null, "is_primary" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "contractor_id" uuid not null, constraint "contractor_addresses_pkey" primary key ("id"));`);
    this.addSql(`create index "contractor_addresses_contractor_idx" on "contractor_addresses" ("contractor_id");`);

    this.addSql(`create table "contractor_contacts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "first_name" text not null, "last_name" text not null, "job_title" text null, "department" text null, "email" text null, "phone" text null, "mobile" text null, "is_primary" boolean not null default false, "is_active" boolean not null default true, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "contractor_id" uuid not null, constraint "contractor_contacts_pkey" primary key ("id"));`);
    this.addSql(`create index "contractor_contacts_contractor_idx" on "contractor_contacts" ("contractor_id");`);

    this.addSql(`create table "contractor_credit_limits" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "credit_limit" numeric(18,2) not null, "currency_code" text not null default 'USD', "is_unlimited" boolean not null default false, "current_exposure" numeric(18,2) not null default '0', "last_calculated_at" timestamptz null, "requires_approval_above" numeric(18,2) null, "approved_by_id" uuid null, "approved_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "contractor_id" uuid not null, constraint "contractor_credit_limits_pkey" primary key ("id"));`);
    this.addSql(`alter table "contractor_credit_limits" add constraint "contractor_credit_limits_contractor_id_unique" unique ("contractor_id");`);
    this.addSql(`create index "contractor_credit_limits_contractor_idx" on "contractor_credit_limits" ("contractor_id");`);

    this.addSql(`create table "contractor_payment_terms" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "payment_days" int not null default 30, "payment_method" text null, "currency_code" text not null default 'USD', "bank_name" text null, "bank_account_number" text null, "bank_routing_number" text null, "iban" text null, "swift_bic" text null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "contractor_id" uuid not null, constraint "contractor_payment_terms_pkey" primary key ("id"));`);
    this.addSql(`alter table "contractor_payment_terms" add constraint "contractor_payment_terms_contractor_id_unique" unique ("contractor_id");`);
    this.addSql(`create index "contractor_payment_terms_contractor_idx" on "contractor_payment_terms" ("contractor_id");`);

    this.addSql(`create table "contractor_role_types" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "category" text not null, "description" text null, "color" text null, "icon" text null, "has_custom_fields" boolean not null default false, "sort_order" int not null default 0, "is_system" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "contractor_role_types_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_contractor_role_types_category" on "contractor_role_types" ("tenant_id", "organization_id", "category") where is_active = true;`);
    this.addSql(`create index "contractor_role_types_org_tenant_idx" on "contractor_role_types" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "contractor_role_types" add constraint "contractor_role_types_code_unique" unique ("organization_id", "tenant_id", "code");`);

    this.addSql(`create table "contractor_roles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "settings" jsonb null, "is_active" boolean not null default true, "effective_from" timestamptz null, "effective_to" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "contractor_id" uuid not null, "role_type_id" uuid not null, constraint "contractor_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_contractor_roles_role_type" on "contractor_roles" ("tenant_id", "organization_id", "role_type_id") where is_active = true;`);
    this.addSql(`create index "contractor_roles_contractor_idx" on "contractor_roles" ("contractor_id");`);
    this.addSql(`alter table "contractor_roles" add constraint "contractor_roles_unique" unique ("contractor_id", "role_type_id");`);

    this.addSql(`alter table "contractor_addresses" add constraint "contractor_addresses_contractor_id_foreign" foreign key ("contractor_id") references "contractors" ("id") on update cascade;`);

    this.addSql(`alter table "contractor_contacts" add constraint "contractor_contacts_contractor_id_foreign" foreign key ("contractor_id") references "contractors" ("id") on update cascade;`);

    this.addSql(`alter table "contractor_credit_limits" add constraint "contractor_credit_limits_contractor_id_foreign" foreign key ("contractor_id") references "contractors" ("id") on update cascade;`);

    this.addSql(`alter table "contractor_payment_terms" add constraint "contractor_payment_terms_contractor_id_foreign" foreign key ("contractor_id") references "contractors" ("id") on update cascade;`);

    this.addSql(`alter table "contractor_roles" add constraint "contractor_roles_contractor_id_foreign" foreign key ("contractor_id") references "contractors" ("id") on update cascade;`);
    this.addSql(`alter table "contractor_roles" add constraint "contractor_roles_role_type_id_foreign" foreign key ("role_type_id") references "contractor_role_types" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "contractor_addresses" drop constraint "contractor_addresses_contractor_id_foreign";`);
    this.addSql(`alter table "contractor_contacts" drop constraint "contractor_contacts_contractor_id_foreign";`);
    this.addSql(`alter table "contractor_credit_limits" drop constraint "contractor_credit_limits_contractor_id_foreign";`);
    this.addSql(`alter table "contractor_payment_terms" drop constraint "contractor_payment_terms_contractor_id_foreign";`);
    this.addSql(`alter table "contractor_roles" drop constraint "contractor_roles_contractor_id_foreign";`);
    this.addSql(`alter table "contractor_roles" drop constraint "contractor_roles_role_type_id_foreign";`);

    this.addSql(`drop table if exists "contractor_roles" cascade;`);
    this.addSql(`drop table if exists "contractor_role_types" cascade;`);
    this.addSql(`drop table if exists "contractor_payment_terms" cascade;`);
    this.addSql(`drop table if exists "contractor_credit_limits" cascade;`);
    this.addSql(`drop table if exists "contractor_contacts" cascade;`);
    this.addSql(`drop table if exists "contractor_addresses" cascade;`);
    this.addSql(`drop table if exists "contractors" cascade;`);
  }
}
