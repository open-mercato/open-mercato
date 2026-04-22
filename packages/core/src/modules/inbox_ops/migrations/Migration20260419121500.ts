import { Migration } from '@mikro-orm/migrations';

export class Migration20260419121500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      update "inbox_source_submissions"
      set "legacy_inbox_email_id" = "source_entity_id"
      where "deleted_at" is null
        and "source_entity_type" = 'inbox_ops:inbox_email'
        and "legacy_inbox_email_id" is null;
    `);

    this.addSql(`
      update "inbox_source_submissions"
      set
        "status" = 'failed',
        "processing_error" = coalesce(
          "processing_error",
          'Legacy inbox email was pending during source_submission migration. Use reprocess to resume it.'
        ),
        "metadata" = coalesce("metadata", '{}'::jsonb) || jsonb_build_object(
          'migratedFromLegacyEmailFlow', true,
          'migrationOrigin', 'updated_existing_submission',
          'legacyStatusBeforeMigration', "status"
        ),
        "updated_at" = now()
      where "deleted_at" is null
        and "source_entity_type" = 'inbox_ops:inbox_email'
        and "status" in ('received', 'processing');
    `);

    this.addSql(`
      with "orphan_pending_emails" as (
        select
          "e"."id",
          "e"."organization_id",
          "e"."tenant_id",
          "e"."created_at",
          "e"."updated_at",
          coalesce("e"."updated_at"::text, 'legacy-email:' || "e"."id"::text) as "source_version",
          encode(
            digest(
              to_json(array[
                "e"."tenant_id"::text,
                "e"."organization_id"::text,
                'inbox_ops:inbox_email',
                "e"."id"::text,
                '',
                coalesce("e"."updated_at"::text, 'legacy-email:' || "e"."id"::text)
              ]::text[])::text,
              'sha256'
            ),
            'hex'
          ) as "source_dedup_key"
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
          )
      )
      insert into "inbox_source_submissions" (
        "id",
        "source_entity_type",
        "source_entity_id",
        "source_artifact_id",
        "source_version",
        "source_dedup_key",
        "trigger_event_id",
        "status",
        "legacy_inbox_email_id",
        "normalized_title",
        "normalized_body",
        "normalized_body_format",
        "normalized_participants",
        "normalized_timeline",
        "normalized_attachments",
        "normalized_capabilities",
        "facts",
        "normalized_source_metadata",
        "source_snapshot",
        "processing_error",
        "proposal_id",
        "requested_by_user_id",
        "metadata",
        "is_active",
        "organization_id",
        "tenant_id",
        "created_at",
        "updated_at",
        "deleted_at"
      )
      select
        gen_random_uuid(),
        'inbox_ops:inbox_email',
        "orphan_pending_emails"."id",
        null,
        "orphan_pending_emails"."source_version",
        "orphan_pending_emails"."source_dedup_key",
        null,
        'failed',
        "orphan_pending_emails"."id",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'Legacy inbox email was pending during source_submission migration. Use reprocess to resume it.',
        null,
        null,
        jsonb_build_object(
          'migratedFromLegacyEmailFlow', true,
          'migrationOrigin', 'inserted_orphan_email'
        ),
        true,
        "orphan_pending_emails"."organization_id",
        "orphan_pending_emails"."tenant_id",
        "orphan_pending_emails"."created_at",
        "orphan_pending_emails"."updated_at",
        null
      from "orphan_pending_emails";
    `);

    this.addSql(`
      update "inbox_emails"
      set
        "status" = 'failed',
        "processing_error" = coalesce(
          "processing_error",
          'Legacy inbox email was pending during source_submission migration. Use reprocess to resume it.'
        ),
        "updated_at" = now()
      where "deleted_at" is null
        and "status" in ('received', 'processing');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      delete from "inbox_source_submissions"
      where "metadata"->>'migrationOrigin' = 'inserted_orphan_email';
    `);

    this.addSql(`
      update "inbox_source_submissions"
      set
        "status" = case
          when coalesce("metadata"->>'legacyStatusBeforeMigration', '') in ('received', 'processing')
            then ("metadata"->>'legacyStatusBeforeMigration')
          else 'received'
        end,
        "processing_error" = case
          when "processing_error" = 'Legacy inbox email was pending during source_submission migration. Use reprocess to resume it.'
            then null
          else "processing_error"
        end,
        "metadata" = coalesce("metadata", '{}'::jsonb)
          - 'migratedFromLegacyEmailFlow'
          - 'migrationOrigin'
          - 'legacyStatusBeforeMigration'
      where "metadata"->>'migrationOrigin' = 'updated_existing_submission';
    `);

    this.addSql(`
      update "inbox_emails"
      set
        "status" = 'received',
        "processing_error" = null
      where "status" = 'failed'
        and "processing_error" = 'Legacy inbox email was pending during source_submission migration. Use reprocess to resume it.';
    `);
  }

}
