import { Migration } from '@mikro-orm/migrations';

export class Migration20260418132408 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "inbox_source_submissions" ("id" uuid not null default gen_random_uuid(), "source_entity_type" text not null, "source_entity_id" uuid not null, "source_artifact_id" uuid null, "source_version" text null, "source_dedup_key" text not null, "trigger_event_id" text null, "status" text not null default 'received', "legacy_inbox_email_id" uuid null, "normalized_title" text null, "normalized_body" text null, "normalized_body_format" text null, "normalized_participants" jsonb null, "normalized_timeline" jsonb null, "normalized_attachments" jsonb null, "normalized_capabilities" jsonb null, "facts" jsonb null, "normalized_source_metadata" jsonb null, "source_snapshot" jsonb null, "processing_error" text null, "proposal_id" uuid null, "requested_by_user_id" uuid null, "metadata" jsonb null, "is_active" boolean not null default true, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_source_submissions_pkey" primary key ("id"));`);
    this.addSql(`create index "inbox_source_submissions_legacy_inbox_email_id_index" on "inbox_source_submissions" ("legacy_inbox_email_id");`);
    this.addSql(`create index "inbox_source_submissions_proposal_id_index" on "inbox_source_submissions" ("proposal_id");`);
    this.addSql(`create index "inbox_source_submissions_organization_id_tenant_id_89a63_index" on "inbox_source_submissions" ("organization_id", "tenant_id", "source_entity_type", "source_entity_id");`);
    this.addSql(`create index "inbox_source_submissions_organization_id_tenant_id_b93c6_index" on "inbox_source_submissions" ("organization_id", "tenant_id", "status", "created_at");`);
    this.addSql(`alter table "inbox_source_submissions" add constraint "inbox_source_submissions_source_dedup_key_unique" unique ("source_dedup_key");`);

    this.addSql(`alter table "inbox_proposals" add column "source_submission_id" uuid null, add column "source_entity_type" text null, add column "source_entity_id" uuid null, add column "source_artifact_id" uuid null, add column "source_version" text null, add column "source_snapshot" jsonb null;`);
    this.addSql(`alter table "inbox_proposals" alter column "inbox_email_id" drop default;`);
    this.addSql(`alter table "inbox_proposals" alter column "inbox_email_id" type uuid using ("inbox_email_id"::text::uuid);`);
    this.addSql(`alter table "inbox_proposals" alter column "inbox_email_id" drop not null;`);
    this.addSql(`create index "inbox_proposals_organization_id_tenant_id_source_e_70ee9_index" on "inbox_proposals" ("organization_id", "tenant_id", "source_entity_type", "source_entity_id");`);
    this.addSql(`create index "inbox_proposals_source_submission_id_index" on "inbox_proposals" ("source_submission_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "inbox_proposals_organization_id_tenant_id_source_e_70ee9_index";`);
    this.addSql(`drop index "inbox_proposals_source_submission_id_index";`);
    this.addSql(`alter table "inbox_proposals" drop column "source_submission_id", drop column "source_entity_type", drop column "source_entity_id", drop column "source_artifact_id", drop column "source_version", drop column "source_snapshot";`);

    this.addSql(`alter table "inbox_proposals" alter column "inbox_email_id" drop default;`);
    this.addSql(`alter table "inbox_proposals" alter column "inbox_email_id" type uuid using ("inbox_email_id"::text::uuid);`);
    this.addSql(`alter table "inbox_proposals" alter column "inbox_email_id" set not null;`);
  }

}
