import { Migration } from '@mikro-orm/migrations';

export class Migration20260508140932_forms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "forms_form_submission" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "form_version_id" uuid not null, "subject_type" text not null, "subject_id" uuid not null, "status" text not null default 'draft', "current_revision_id" uuid null, "started_by" uuid not null, "submitted_by" uuid null, "first_saved_at" timestamptz not null, "submitted_at" timestamptz null, "submit_metadata" jsonb null, "pdf_snapshot_attachment_id" uuid null, "anonymized_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_form_submission_org_version_status_idx" on "forms_form_submission" ("organization_id", "form_version_id", "status");`);
    this.addSql(`create index "forms_form_submission_subject_idx" on "forms_form_submission" ("subject_type", "subject_id");`);
    this.addSql(`create index "forms_form_submission_org_submitted_at_idx" on "forms_form_submission" ("organization_id", "submitted_at");`);
    this.addSql(`create index "forms_form_submission_org_tenant_deleted_idx" on "forms_form_submission" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "forms_form_submission_actor" ("id" uuid not null default gen_random_uuid(), "submission_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "role" text not null, "assigned_at" timestamptz not null, "revoked_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_form_submission_actor_org_idx" on "forms_form_submission_actor" ("organization_id");`);
    this.addSql(`create index "forms_form_submission_actor_submission_role_idx" on "forms_form_submission_actor" ("submission_id", "role");`);
    // Partial-unique: only one active (non-revoked) actor row per (submission, user).
    this.addSql(`create unique index "forms_form_submission_actor_submission_user_active_unique" on "forms_form_submission_actor" ("submission_id", "user_id") where "revoked_at" is null;`);

    this.addSql(`create table "forms_form_submission_revision" ("id" uuid not null default gen_random_uuid(), "submission_id" uuid not null, "organization_id" uuid not null, "revision_number" int not null, "data" bytea not null, "encryption_key_version" int not null, "saved_at" timestamptz not null, "saved_by" uuid not null, "saved_by_role" text not null, "change_source" text not null default 'user', "changed_field_keys" text[] not null, "change_summary" text null, "anonymized_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_form_submission_revision_submission_idx" on "forms_form_submission_revision" ("submission_id", "revision_number");`);
    this.addSql(`create index "forms_form_submission_revision_org_saved_idx" on "forms_form_submission_revision" ("organization_id", "saved_at");`);

    this.addSql(`create table "forms_encryption_key" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "key_version" int not null, "wrapped_dek" bytea not null, "created_at" timestamptz not null, "retired_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "forms_encryption_key" add constraint "forms_encryption_key_org_version_unique" unique ("organization_id", "key_version");`);
  }

}
