import { Migration } from '@mikro-orm/migrations';

export class Migration20260521120000_forms extends Migration {

  override up(): void | Promise<void> {
    // Phase 3 Track D — per-subject consent-record projection from signed
    // `signature` fields. PII-free: clause SHA + signed_at + ids only.
    this.addSql(`create table "forms_consent_record" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_type" text not null, "subject_id" uuid not null, "form_id" uuid not null, "form_version_id" uuid not null, "version_number" int not null, "submission_id" uuid not null, "consent_field_key" text not null, "clause_sha256" text not null, "signed_at" timestamptz not null, "status" text not null default 'active', "superseded_by_record_id" uuid null, "superseded_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "forms_consent_record_org_subject_idx" on "forms_consent_record" ("organization_id", "subject_type", "subject_id");`);
    this.addSql(`create index "forms_consent_record_org_form_status_idx" on "forms_consent_record" ("organization_id", "form_id", "status");`);
    this.addSql(`create index "forms_consent_record_submission_idx" on "forms_consent_record" ("submission_id");`);
    // Idempotency anchor: one record per (submission, consent_field_key) so
    // re-delivery of `forms.submission.submitted` cannot double-insert.
    this.addSql(`create unique index "forms_consent_record_submission_field_unique" on "forms_consent_record" ("submission_id", "consent_field_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "forms_consent_record" cascade;`);
  }

}
