import { Migration } from '@mikro-orm/migrations';

export class Migration20260923144607_fleet_management extends Migration {

  override name = 'Migration20260923144607';

  override up(): void | Promise<void> {
    this.addSql(`create table "fleet_vehicles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "plate_number" text not null, "sequence_number" text null, "make" text not null, "model" text not null, "year" int not null, "color" text null, "vehicle_type" text null, "status" text not null default 'active', "current_odometer" int not null default 0, "assigned_employee_id" uuid null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_vehicles_plate_unique_idx" on "fleet_vehicles" ("organization_id", "tenant_id", "plate_number");`);
    this.addSql(`create index "fleet_vehicles_status_idx" on "fleet_vehicles" ("organization_id", "status");`);
    this.addSql(`create index "fleet_vehicles_tenant_org_idx" on "fleet_vehicles" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "fleet_vehicles" add constraint "fleet_vehicles_status_check" check ("status" in ('active', 'assigned', 'maintenance', 'out_of_service'));`);

    this.addSql(`create table "fleet_vehicle_assignments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "employee_id" uuid not null, "approval_request_id" uuid null, "status" text not null default 'pending_approval', "assigned_at" timestamptz null, "due_return_at" timestamptz null, "returned_at" timestamptz null, "handover_odometer" int null, "return_odometer" int null, "custody_notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_vehicle_assignments_approval_idx" on "fleet_vehicle_assignments" ("organization_id", "approval_request_id");`);
    this.addSql(`create index "fleet_vehicle_assignments_status_idx" on "fleet_vehicle_assignments" ("organization_id", "status");`);
    this.addSql(`create index "fleet_vehicle_assignments_employee_idx" on "fleet_vehicle_assignments" ("organization_id", "employee_id");`);
    this.addSql(`create index "fleet_vehicle_assignments_vehicle_idx" on "fleet_vehicle_assignments" ("organization_id", "vehicle_id");`);
    this.addSql(`create index "fleet_vehicle_assignments_tenant_org_idx" on "fleet_vehicle_assignments" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "fleet_vehicle_assignments" add constraint "fleet_vehicle_assignments_status_check" check ("status" in ('pending_approval', 'active', 'returned', 'rejected', 'cancelled'));`);

    this.addSql(`create table "fleet_vehicle_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "document_type" text not null, "document_number" text null, "issue_date" date null, "expiry_date" date null, "file_attachment_id" uuid null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_vehicle_documents_type_idx" on "fleet_vehicle_documents" ("organization_id", "document_type");`);
    this.addSql(`create index "fleet_vehicle_documents_expiry_idx" on "fleet_vehicle_documents" ("organization_id", "expiry_date");`);
    this.addSql(`create index "fleet_vehicle_documents_vehicle_idx" on "fleet_vehicle_documents" ("organization_id", "vehicle_id");`);
    this.addSql(`create index "fleet_vehicle_documents_tenant_org_idx" on "fleet_vehicle_documents" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "fleet_vehicle_documents" add constraint "fleet_vehicle_documents_document_type_check" check ("document_type" in ('istimara', 'insurance', 'fahs', 'operating_card', 'other'));`);

    this.addSql(`create table "fleet_vehicle_odometer_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "vehicle_id" uuid not null, "reading" int not null, "recorded_at" timestamptz not null, "source" text null, "assignment_id" uuid null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "fleet_odometer_logs_vehicle_idx" on "fleet_vehicle_odometer_logs" ("organization_id", "vehicle_id", "recorded_at");`);
    this.addSql(`create index "fleet_odometer_logs_tenant_org_idx" on "fleet_vehicle_odometer_logs" ("tenant_id", "organization_id");`);
  }

}
