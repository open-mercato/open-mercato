import { Migration } from '@mikro-orm/migrations';

export class Migration20260107122137 extends Migration {

  override async up(): Promise<void> {
    
    this.addSql(`create table "booking_availability_rules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "subject_type" text check ("subject_type" in ('member', 'resource')) not null, "subject_id" uuid not null, "timezone" text not null, "rrule" text not null, "exdates" jsonb not null default '[]', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_availability_rules_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_availability_rules_subject_idx" on "booking_availability_rules" ("subject_type", "subject_id", "tenant_id", "organization_id");`);
    this.addSql(`create index "booking_availability_rules_tenant_org_idx" on "booking_availability_rules" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_events" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "service_id" uuid not null, "title" text not null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, "timezone" text null, "rrule" text null, "exdates" jsonb not null default '[]', "status" text check ("status" in ('draft', 'negotiation', 'confirmed', 'cancelled')) not null, "requires_confirmations" boolean not null default false, "confirmation_mode" text check ("confirmation_mode" in ('all_members', 'any_member', 'by_role')) not null, "confirmation_deadline_at" timestamptz null, "confirmed_at" timestamptz null, "tags" jsonb not null default '[]', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_events_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_events_status_idx" on "booking_events" ("status", "tenant_id", "organization_id");`);
    this.addSql(`create index "booking_events_tenant_org_idx" on "booking_events" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_event_attendees" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "event_id" uuid not null, "first_name" text not null, "last_name" text not null, "email" text null, "phone" text null, "address_line1" text null, "address_line2" text null, "city" text null, "region" text null, "postal_code" text null, "country" text null, "attendee_type" text null, "external_ref" text null, "tags" jsonb not null default '[]', "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_event_attendees_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_event_attendees_tenant_org_idx" on "booking_event_attendees" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_event_confirmations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "event_id" uuid not null, "member_id" uuid not null, "status" text check ("status" in ('pending', 'accepted', 'declined')) not null, "responded_at" timestamptz null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_event_confirmations_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_event_confirmations_tenant_org_idx" on "booking_event_confirmations" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_event_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "event_id" uuid not null, "member_id" uuid not null, "role_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_event_members_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_event_members_tenant_org_idx" on "booking_event_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_event_resources" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "event_id" uuid not null, "resource_id" uuid not null, "qty" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_event_resources_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_event_resources_tenant_org_idx" on "booking_event_resources" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_resources" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "resource_type_id" uuid null, "capacity" int null, "tags" jsonb not null default '[]', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_resources_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_resources_tenant_org_idx" on "booking_resources" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_resource_types" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_resource_types_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_resource_types_tenant_org_idx" on "booking_resource_types" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_services" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "duration_minutes" int not null, "capacity_model" text check ("capacity_model" in ('one_to_one', 'one_to_many', 'many_to_many')) not null, "max_attendees" int null, "required_roles" jsonb not null default '[]', "required_members" jsonb not null default '[]', "required_resources" jsonb not null default '[]', "required_resource_types" jsonb not null default '[]', "tags" jsonb not null default '[]', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_services_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_services_tenant_org_idx" on "booking_services" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_service_products" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "service_id" uuid not null, "product_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_service_products_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_service_products_unique_idx" on "booking_service_products" ("service_id", "product_id");`);
    this.addSql(`create index "booking_service_products_tenant_org_idx" on "booking_service_products" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_service_product_variants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "service_id" uuid not null, "variant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_service_product_variants_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_service_product_variants_unique_idx" on "booking_service_product_variants" ("service_id", "variant_id");`);
    this.addSql(`create index "booking_service_product_variants_tenant_org_idx" on "booking_service_product_variants" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_team_members" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "display_name" text not null, "user_id" uuid null, "role_ids" jsonb not null default '[]', "tags" jsonb not null default '[]', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_team_members_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_team_members_tenant_org_idx" on "booking_team_members" ("tenant_id", "organization_id");`);

    this.addSql(`create table "booking_team_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "description" text null, "appearance_icon" text null, "appearance_color" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "booking_team_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "booking_team_roles_tenant_org_idx" on "booking_team_roles" ("tenant_id", "organization_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "booking_event_confirmations" cascade;`);
    this.addSql(`drop table if exists "booking_event_resources" cascade;`);
    this.addSql(`drop table if exists "booking_event_members" cascade;`);
    this.addSql(`drop table if exists "booking_event_attendees" cascade;`);
    this.addSql(`drop table if exists "booking_events" cascade;`);
    this.addSql(`drop table if exists "booking_availability_rules" cascade;`);
    this.addSql(`drop table if exists "booking_service_product_variants" cascade;`);
    this.addSql(`drop table if exists "booking_service_products" cascade;`);
    this.addSql(`drop table if exists "booking_resources" cascade;`);
    this.addSql(`drop table if exists "booking_resource_types" cascade;`);
    this.addSql(`drop table if exists "booking_services" cascade;`);
    this.addSql(`drop table if exists "booking_team_members" cascade;`);
    this.addSql(`drop table if exists "booking_team_roles" cascade;`);
  }

}
