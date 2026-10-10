import { Migration } from '@mikro-orm/migrations';

export class Migration20261010044135_vehicle_rentals extends Migration {

  override name = 'Migration20261010044135';

  override up(): void | Promise<void> {
    this.addSql(`create table "rental_contracts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "rental_number" text not null, "status" text not null default 'draft', "rental_type" text not null default 'with_driver', "client_type" text not null default 'b2b', "duration_type" text not null default 'daily', "customer_id" uuid not null, "customer_snapshot" jsonb not null, "vehicle_id" uuid null, "vehicle_snapshot" jsonb null, "driver_id" uuid null, "driver_snapshot" jsonb null, "start_at" timestamptz null, "end_at" timestamptz null, "actual_start_at" timestamptz null, "actual_end_at" timestamptz null, "daily_rate" numeric(18,4) not null default '0', "weekly_rate" numeric(18,4) not null default '0', "monthly_rate" numeric(18,4) not null default '0', "included_km" int null, "extra_km_rate" numeric(18,4) null, "odo_start_km" int null, "odo_end_km" int null, "usage_km" int null, "extra_km" int null, "rental_amount_net" numeric(18,4) not null default '0', "extra_km_amount_net" numeric(18,4) not null default '0', "total_net_amount" numeric(18,4) not null default '0', "tax_rate" numeric(5,2) not null default '15', "tax_amount" numeric(18,4) not null default '0', "total_gross_amount" numeric(18,4) not null default '0', "currency_code" text not null default 'SAR', "handover_at" timestamptz null, "return_at" timestamptz null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "rental_contracts" add constraint "rental_contracts_status_check" check ("status" in ('draft', 'active', 'completed', 'cancelled'));`);
    this.addSql(`alter table "rental_contracts" add constraint "rental_contracts_rental_type_check" check ("rental_type" in ('with_driver', 'without_driver'));`);
    this.addSql(`alter table "rental_contracts" add constraint "rental_contracts_client_type_check" check ("client_type" in ('b2b', 'b2c'));`);
    this.addSql(`alter table "rental_contracts" add constraint "rental_contracts_duration_type_check" check ("duration_type" in ('daily', 'weekly', 'monthly'));`);

    this.addSql(`create table "rental_document_sequences" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "kind" text not null default 'rental', "current_value" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "rental_document_sequences" add constraint "rental_document_sequences_kind_check" check ("kind" in ('rental'));`);

    this.addSql(`create table "rental_vehicle_checks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "contract_id" uuid not null, "kind" text not null, "odometer_km" int not null, "fuel_level" int null, "has_damage" boolean not null default false, "condition_notes" text null, "checked_at" timestamptz not null, "checked_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "rental_vehicle_checks" add constraint "rental_vehicle_checks_kind_check" check ("kind" in ('handover', 'return', 'inspection'));`);

    this.addSql(`alter table "rental_vehicle_checks" add constraint "rental_vehicle_checks_contract_id_foreign" foreign key ("contract_id") references "rental_contracts" ("id");`);

    // Partial unique indexes the ORM metadata cannot express: a document number
    // is unique among live rows only, the sequence counter is one row per scope,
    // and a rental carries at most one live check of each kind.
    this.addSql(`create unique index "rental_contracts_number_unique_idx" on "rental_contracts" ("organization_id", "tenant_id", "rental_number") where deleted_at is null;`);
    this.addSql(`create unique index "rental_document_sequences_kind_unique_idx" on "rental_document_sequences" ("organization_id", "tenant_id", "kind");`);
    this.addSql(`create unique index "rental_vehicle_checks_kind_unique_idx" on "rental_vehicle_checks" ("contract_id", "kind") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "rental_vehicle_checks_kind_unique_idx";`);
    this.addSql(`drop index if exists "rental_document_sequences_kind_unique_idx";`);
    this.addSql(`drop index if exists "rental_contracts_number_unique_idx";`);
    this.addSql(`alter table "rental_vehicle_checks" drop constraint if exists "rental_vehicle_checks_contract_id_foreign";`);
    this.addSql(`drop table if exists "rental_vehicle_checks" cascade;`);
    this.addSql(`drop table if exists "rental_document_sequences" cascade;`);
    this.addSql(`drop table if exists "rental_contracts" cascade;`);
  }

}
