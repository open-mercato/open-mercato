import { Migration } from '@mikro-orm/migrations'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'

// Inbound email attachments (.ai/specs/2026-10-25-inbox-ops-inbound-attachments.md):
// the per-part ledger, the ingest/claim/release columns on `inbox_emails` and the
// encrypted field provenance on `inbox_proposal_actions`. Additive only.
//
// The encryption maps below are literal copies of `inbox_ops/encryption.ts` at the time of
// this migration (migrations must not follow later edits of the module map). Encryption maps
// are seeded per tenant only at tenant creation, so without the backfill existing tenants
// would store `file_name`, `extracted_text` and `source_refs` as plaintext.
export class Migration20261108130000_inbox_ops extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "inbox_email_attachments" ("id" uuid not null default gen_random_uuid(), "inbox_email_id" uuid not null, "part_key" text not null, "file_name" text null, "declared_mime_type" text null, "mime_type" text null, "size_bytes" int null, "content_id" text null, "attempts" int not null default 0, "in_flight_at" timestamptz null, "disposition" text not null, "status" text not null, "reason" text null, "attachment_id" uuid null, "extracted_text" text null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "inbox_email_attachments_pkey" primary key ("id"));`)
    this.addSql(`create index "inbox_email_attachments_scope_email_idx" on "inbox_email_attachments" ("organization_id", "tenant_id", "inbox_email_id");`)
    this.addSql(`alter table "inbox_email_attachments" add constraint "inbox_email_attachments_email_part_key_unique" unique ("inbox_email_id", "part_key");`)
    this.addSql(`create index "inbox_email_attachments_stored_idx" on "inbox_email_attachments" ("inbox_email_id") where status = 'stored' and deleted_at is null;`)

    this.addSql(`alter table "inbox_emails" add column "attachments_status" text null, add column "attachments_claim_token" uuid null, add column "attachments_claimed_at" timestamptz null, add column "attachments_first_failure_at" timestamptz null, add column "attachments_release_requested_at" timestamptz null, add column "attachments_released_at" timestamptz null, add column "attachments_ingest_generation" int null default 0, add column "attachments_current_generation" int null default 0, add column "attachments_next_run_at" timestamptz null;`)
    this.addSql(`create index "inbox_emails_attachments_status_attachments_next_run_at_index" on "inbox_emails" ("attachments_status", "attachments_next_run_at");`)
    this.addSql(`create index "inbox_emails_attachments_status_attachments_claimed_at_index" on "inbox_emails" ("attachments_status", "attachments_claimed_at");`)
    this.addSql(`create index "inbox_emails_attachments_release_pending_idx" on "inbox_emails" ("tenant_id", "organization_id") where deleted_at is not null and attachments_released_at is null and (attachments_status is not null or attachments_release_requested_at is not null);`)

    this.addSql(`alter table "inbox_proposal_actions" add column "source_refs" jsonb null;`)

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'inbox_ops:inbox_email_attachment',
      fields: [
        { field: 'file_name' },
        { field: 'extracted_text' },
      ],
    }))
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'inbox_ops:inbox_proposal_action',
      fields: [
        { field: 'description' },
        { field: 'payload' },
        { field: 'execution_error' },
        { field: 'source_refs' },
      ],
    }))
  }

  override async down(): Promise<void> {
    // The encryption-map backfill is forward-only: deleting map rows by entity id would also
    // remove maps seeded at tenant creation or edited by admins and switch encryption off.
    this.addSql(`alter table "inbox_proposal_actions" drop column if exists "source_refs";`)

    this.addSql(`drop index if exists "inbox_emails_attachments_release_pending_idx";`)
    this.addSql(`drop index if exists "inbox_emails_attachments_status_attachments_claimed_at_index";`)
    this.addSql(`drop index if exists "inbox_emails_attachments_status_attachments_next_run_at_index";`)
    this.addSql(`alter table "inbox_emails" drop column if exists "attachments_status", drop column if exists "attachments_claim_token", drop column if exists "attachments_claimed_at", drop column if exists "attachments_first_failure_at", drop column if exists "attachments_release_requested_at", drop column if exists "attachments_released_at", drop column if exists "attachments_ingest_generation", drop column if exists "attachments_current_generation", drop column if exists "attachments_next_run_at";`)

    this.addSql(`drop table if exists "inbox_email_attachments" cascade;`)
  }

}
