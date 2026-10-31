import { Migration } from '@mikro-orm/migrations';

export class Migration20260508155737_forms extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "forms_form_access_audit" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "submission_id" uuid not null, "accessed_by" uuid not null, "accessed_at" timestamptz not null, "access_purpose" text not null, "ip" text null, "ua" text null, "revision_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "forms_access_audit_org_idx" on "forms_form_access_audit" ("organization_id", "accessed_at");`);
    this.addSql(`create index "forms_access_audit_submission_idx" on "forms_form_access_audit" ("submission_id", "accessed_at");`);

    this.addSql(`create table "forms_form_attachment" ("id" uuid not null default gen_random_uuid(), "submission_id" uuid not null, "organization_id" uuid not null, "field_key" text not null, "kind" text not null, "file_id" uuid null, "payload_inline" bytea null, "content_type" text null, "filename" text null, "size_bytes" int null, "uploaded_by" uuid null, "uploaded_at" timestamptz not null, "removed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "forms_attachment_org_kind_idx" on "forms_form_attachment" ("organization_id", "kind");`);
    this.addSql(`create index "forms_attachment_submission_field_idx" on "forms_form_attachment" ("submission_id", "field_key");`);
  }

}
