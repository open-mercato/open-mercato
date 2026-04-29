import { createHash } from "node:crypto";
import { Migration } from "@mikro-orm/migrations";

const LEGACY_PENDING_EMAIL_ERROR =
  "Legacy inbox email was pending during source_submission migration. Use reprocess to resume it.";

type OrphanPendingEmailRow = {
  id: string;
  organization_id: string;
  tenant_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  source_version: string;
};

function buildLegacySourceDedupKey(row: OrphanPendingEmailRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.tenant_id,
        row.organization_id,
        "inbox_ops:inbox_email",
        row.id,
        "",
        row.source_version,
      ]),
    )
    .digest("hex");
}

export class Migration20260419121500 extends Migration {
  /**
   * BLAST RADIUS: This migration force-fails any in-flight `inbox_source_submissions`
   * and `inbox_emails` in 'received' or 'processing' status for legacy email sources
   * at deploy time. Extractions currently mid-flight will be marked 'failed' and must
   * be resumed via the reprocess endpoint. Operators should drain the extraction queue
   * before deploying or plan for a post-deploy reprocess sweep. See RELEASE_NOTES v0.4.4.
   */
  override async up(): Promise<void> {
    const knex = this.getKnex();

    await this.execute(`
      update "inbox_source_submissions"
      set "legacy_inbox_email_id" = "source_entity_id"
      where "deleted_at" is null
        and "source_entity_type" = 'inbox_ops:inbox_email'
        and "legacy_inbox_email_id" is null;
    `);

    await this.execute(
      knex.raw(
        `
        update "inbox_source_submissions"
        set
          "status" = 'failed',
          "processing_error" = coalesce("processing_error", ?),
          "metadata" = coalesce("metadata", '{}'::jsonb) || jsonb_build_object(
            'migratedFromLegacyEmailFlow', true,
            'migrationOrigin', 'updated_existing_submission',
            'legacyStatusBeforeMigration', "status"
          ),
          "updated_at" = now()
        where "deleted_at" is null
          and "source_entity_type" = 'inbox_ops:inbox_email'
          and "status" in ('received', 'processing');
        `,
        [LEGACY_PENDING_EMAIL_ERROR],
      ),
    );

    const orphanPendingEmails = (await this.execute(`
      select
        "e"."id",
        "e"."organization_id",
        "e"."tenant_id",
        "e"."created_at",
        "e"."updated_at",
        coalesce("e"."updated_at"::text, 'legacy-email:' || "e"."id"::text) as "source_version"
      from "inbox_emails" as "e"
      where "e"."deleted_at" is null
        and "e"."status" in ('received', 'processing')
        and not exists (
          select 1
          from "inbox_source_submissions" as "s"
          where "s"."deleted_at" is null
            and (
              "s"."legacy_inbox_email_id" = "e"."id"
              or (
                "s"."source_entity_type" = 'inbox_ops:inbox_email'
                and "s"."source_entity_id" = "e"."id"
              )
            )
        );
    `)) as OrphanPendingEmailRow[];

    if (orphanPendingEmails.length > 0) {
      await this.execute(
        this.getKnex()
          .insert(
            orphanPendingEmails.map((row) => ({
              source_entity_type: "inbox_ops:inbox_email",
              source_entity_id: row.id,
              source_artifact_id: null,
              source_version: row.source_version,
              source_dedup_key: buildLegacySourceDedupKey(row),
              trigger_event_id: null,
              status: "failed",
              legacy_inbox_email_id: row.id,
              normalized_title: null,
              normalized_body: null,
              normalized_body_format: null,
              normalized_participants: null,
              normalized_timeline: null,
              normalized_attachments: null,
              normalized_capabilities: null,
              facts: null,
              normalized_source_metadata: null,
              source_snapshot: null,
              processing_error: LEGACY_PENDING_EMAIL_ERROR,
              proposal_id: null,
              requested_by_user_id: null,
              metadata: {
                migratedFromLegacyEmailFlow: true,
                migrationOrigin: "inserted_orphan_email",
              },
              is_active: true,
              organization_id: row.organization_id,
              tenant_id: row.tenant_id,
              created_at: row.created_at,
              updated_at: row.updated_at,
              deleted_at: null,
            })),
          )
          .into("inbox_source_submissions"),
      );
    }

    await this.execute(
      knex.raw(
        `
        update "inbox_emails"
        set
          "status" = 'failed',
          "processing_error" = coalesce("processing_error", ?),
          "updated_at" = now()
        where "deleted_at" is null
          and "status" in ('received', 'processing');
        `,
        [LEGACY_PENDING_EMAIL_ERROR],
      ),
    );
  }

  override async down(): Promise<void> {
    const knex = this.getKnex();

    this.addSql(`
      delete from "inbox_source_submissions"
      where "metadata"->>'migrationOrigin' = 'inserted_orphan_email';
    `);

    this.addSql(
      knex.raw(
        `
        update "inbox_source_submissions"
        set
          "status" = case
            when coalesce("metadata"->>'legacyStatusBeforeMigration', '') in ('received', 'processing')
              then ("metadata"->>'legacyStatusBeforeMigration')
            else 'received'
          end,
          "processing_error" = case
            when "processing_error" = ?
              then null
            else "processing_error"
          end,
          "metadata" = coalesce("metadata", '{}'::jsonb)
            - 'migratedFromLegacyEmailFlow'
            - 'migrationOrigin'
            - 'legacyStatusBeforeMigration'
        where "metadata"->>'migrationOrigin' = 'updated_existing_submission';
        `,
        [LEGACY_PENDING_EMAIL_ERROR],
      ),
    );

    this.addSql(
      knex.raw(
        `
        update "inbox_emails"
        set
          "status" = 'received',
          "processing_error" = null
        where "status" = 'failed'
          and "processing_error" = ?;
        `,
        [LEGACY_PENDING_EMAIL_ERROR],
      ),
    );
  }
}
