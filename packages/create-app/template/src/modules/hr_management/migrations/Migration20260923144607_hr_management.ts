import { Migration } from '@mikro-orm/migrations';

export class Migration20260923144607_hr_management extends Migration {

  override name = 'Migration20260923144607';

  override up(): void | Promise<void> {
    this.addSql(`create table "hr_approval_action_logs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "approval_request_id" uuid not null, "step_order" int not null, "action" text not null, "actor_user_id" uuid null, "comment" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_approval_action_logs_request_idx" on "hr_approval_action_logs" ("organization_id", "approval_request_id", "created_at");`);
    this.addSql(`create index "hr_approval_action_logs_tenant_org_idx" on "hr_approval_action_logs" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_approval_action_logs" add constraint "hr_approval_action_logs_action_check" check ("action" in ('approved', 'rejected', 'commented', 'reassigned', 'cancelled'));`);

    this.addSql(`create table "hr_approval_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "workflow_id" uuid not null, "entity_type" text not null, "entity_id" uuid not null, "status" text not null default 'pending', "current_step_order" int not null default 1, "requested_by_user_id" uuid null, "decided_at" timestamptz null, "summary" text null, "payload" jsonb null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_approval_requests_entity_idx" on "hr_approval_requests" ("organization_id", "entity_type", "entity_id");`);
    this.addSql(`create index "hr_approval_requests_workflow_idx" on "hr_approval_requests" ("organization_id", "workflow_id");`);
    this.addSql(`create index "hr_approval_requests_status_idx" on "hr_approval_requests" ("organization_id", "status");`);
    this.addSql(`create index "hr_approval_requests_tenant_org_idx" on "hr_approval_requests" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_approval_requests" add constraint "hr_approval_requests_status_check" check ("status" in ('pending', 'approved', 'rejected', 'cancelled'));`);

    this.addSql(`create table "hr_approval_step_definitions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "workflow_id" uuid not null, "step_order" int not null, "name" text not null, "approver_type" text not null, "approver_role_id" uuid null, "approver_user_id" uuid null, "required_approvals" int not null default 1, "is_final" boolean not null default false, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_approval_steps_workflow_order_idx" on "hr_approval_step_definitions" ("organization_id", "workflow_id", "step_order");`);
    this.addSql(`create index "hr_approval_steps_tenant_org_idx" on "hr_approval_step_definitions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_approval_step_definitions" add constraint "hr_approval_step_definitions_approver_type_check" check ("approver_type" in ('role', 'user', 'manager'));`);

    this.addSql(`create table "hr_approval_workflows" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "code" text not null, "entity_type" text not null, "description" text null, "is_active" boolean not null default true, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_approval_workflows_code_unique_idx" on "hr_approval_workflows" ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "hr_approval_workflows_entity_type_idx" on "hr_approval_workflows" ("organization_id", "entity_type");`);
    this.addSql(`create index "hr_approval_workflows_tenant_org_idx" on "hr_approval_workflows" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_attendance_records" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "date" date not null, "check_in_at" timestamptz null, "check_out_at" timestamptz null, "status" text not null default 'present', "worked_minutes" int null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_attendance_employee_date_unique_idx" on "hr_attendance_records" ("organization_id", "tenant_id", "employee_id", "date");`);
    this.addSql(`create index "hr_attendance_tenant_org_idx" on "hr_attendance_records" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_attendance_records" add constraint "hr_attendance_records_status_check" check ("status" in ('present', 'absent', 'late', 'on_leave', 'holiday'));`);

    this.addSql(`create table "hr_departments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "code" text null, "description" text null, "parent_department_id" uuid null, "manager_employee_id" uuid null, "is_active" boolean not null default true, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_departments_code_unique_idx" on "hr_departments" ("organization_id", "tenant_id", "code");`);
    this.addSql(`create index "hr_departments_tenant_org_idx" on "hr_departments" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_driver_profiles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "license_number" text not null, "license_type" text null, "license_expiry" date not null, "medical_check_expiry" date null, "years_of_experience" int null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_driver_profiles_license_expiry_idx" on "hr_driver_profiles" ("organization_id", "license_expiry");`);
    this.addSql(`create index "hr_driver_profiles_employee_unique_idx" on "hr_driver_profiles" ("organization_id", "tenant_id", "employee_id");`);
    this.addSql(`create index "hr_driver_profiles_tenant_org_idx" on "hr_driver_profiles" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_employees" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_number" text not null, "first_name" text not null, "last_name" text not null, "identity_type" text not null default 'national_id', "national_id" text not null, "national_id_expiry" date null, "department_id" uuid null, "job_title" text not null, "employment_type" text not null default 'full_time', "status" text not null default 'active', "hire_date" date not null, "termination_date" date null, "email" text null, "phone" text null, "user_id" uuid null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_employees_national_id_unique_idx" on "hr_employees" ("organization_id", "tenant_id", "national_id");`);
    this.addSql(`create index "hr_employees_number_unique_idx" on "hr_employees" ("organization_id", "tenant_id", "employee_number");`);
    this.addSql(`create index "hr_employees_department_idx" on "hr_employees" ("organization_id", "department_id");`);
    this.addSql(`create index "hr_employees_status_idx" on "hr_employees" ("organization_id", "status");`);
    this.addSql(`create index "hr_employees_tenant_org_idx" on "hr_employees" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_employees" add constraint "hr_employees_identity_type_check" check ("identity_type" in ('national_id', 'iqama'));`);
    this.addSql(`alter table "hr_employees" add constraint "hr_employees_employment_type_check" check ("employment_type" in ('full_time', 'part_time', 'contract', 'temporary'));`);
    this.addSql(`alter table "hr_employees" add constraint "hr_employees_status_check" check ("status" in ('active', 'on_leave', 'suspended', 'terminated'));`);

    this.addSql(`create table "hr_employee_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "document_type" text not null, "document_number" text null, "issue_date" date null, "expiry_date" date null, "file_attachment_id" uuid null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_employee_documents_type_idx" on "hr_employee_documents" ("organization_id", "document_type");`);
    this.addSql(`create index "hr_employee_documents_expiry_idx" on "hr_employee_documents" ("organization_id", "expiry_date");`);
    this.addSql(`create index "hr_employee_documents_employee_idx" on "hr_employee_documents" ("organization_id", "employee_id");`);
    this.addSql(`create index "hr_employee_documents_tenant_org_idx" on "hr_employee_documents" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_employee_documents" add constraint "hr_employee_documents_document_type_check" check ("document_type" in ('national_id', 'iqama', 'passport', 'driving_license', 'medical_certificate', 'contract', 'certificate', 'other'));`);

    this.addSql(`create table "hr_leave_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "leave_type" text not null, "start_date" date not null, "end_date" date not null, "total_days" int not null, "reason" text null, "status" text not null default 'pending', "approval_request_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "decision_comment" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_leave_requests_status_idx" on "hr_leave_requests" ("organization_id", "status");`);
    this.addSql(`create index "hr_leave_requests_employee_idx" on "hr_leave_requests" ("organization_id", "employee_id");`);
    this.addSql(`create index "hr_leave_requests_tenant_org_idx" on "hr_leave_requests" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "hr_leave_requests" add constraint "hr_leave_requests_leave_type_check" check ("leave_type" in ('annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other'));`);
    this.addSql(`alter table "hr_leave_requests" add constraint "hr_leave_requests_status_check" check ("status" in ('pending', 'approved', 'rejected', 'cancelled'));`);
  }

}
