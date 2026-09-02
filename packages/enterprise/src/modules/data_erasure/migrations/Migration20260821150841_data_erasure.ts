import { Migration } from '@mikro-orm/migrations';

export class Migration20260821150841_data_erasure extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "privacy_legal_holds" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "data_class_id" text null, "subject_kind" text null, "subject_id" text null, "reason" text not null, "expires_at" timestamptz null, "released_at" timestamptz null, "created_by" uuid not null, "released_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "privacy_legal_holds_subject_idx" on "privacy_legal_holds" ("tenant_id", "organization_id", "subject_kind", "subject_id");`);
    this.addSql(`create index "privacy_legal_holds_scope_active_idx" on "privacy_legal_holds" ("tenant_id", "organization_id", "released_at", "expires_at");`);

    this.addSql(`create table "privacy_operations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "type" text not null, "status" text not null, "data_class_id" text null, "subject_kind" text null, "subject_id" text null, "dry_run" boolean not null, "report_json" jsonb null, "requested_by" uuid not null, "completed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "privacy_operations_subject_idx" on "privacy_operations" ("tenant_id", "organization_id", "subject_kind", "subject_id");`);
    this.addSql(`create index "privacy_operations_scope_created_idx" on "privacy_operations" ("tenant_id", "organization_id", "created_at");`);

    this.addSql(`create table "privacy_retention_policies" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "data_class_id" text not null, "retention_days" int not null, "action" text not null, "batch_size" int not null, "is_active" boolean not null default true, "created_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "privacy_retention_policies_scope_active_idx" on "privacy_retention_policies" ("tenant_id", "organization_id", "is_active");`);
    this.addSql(`alter table "privacy_retention_policies" add constraint "privacy_retention_policies_scope_class_unique" unique ("tenant_id", "organization_id", "data_class_id");`);
  }

}
