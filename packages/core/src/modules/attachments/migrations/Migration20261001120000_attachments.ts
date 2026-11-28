import { Migration } from '@mikro-orm/migrations'

export class Migration20261001120000_attachments extends Migration {
  override up(): void {
    this.addSql('alter table "attachment_partitions" add column if not exists "access_resolver_requirements" jsonb null;')
    this.addSql(`
      update attachment_partitions as partition
      set access_resolver_requirements = coalesce(partition.access_resolver_requirements, '[]'::jsonb)
        || '[{"resolverId":"documents.document-attachments","targetEntity":"documents:document"}]'::jsonb,
        updated_at = now()
      where (partition.access_resolver_requirements is null or jsonb_typeof(partition.access_resolver_requirements) = 'array')
        and not coalesce(partition.access_resolver_requirements, '[]'::jsonb)
          @> '[{"resolverId":"documents.document-attachments","targetEntity":"documents:document"}]'::jsonb
        and exists (
          select 1 from attachments as attachment
          where attachment.partition_code = partition.code
            and (
              btrim(attachment.entity_id) = 'documents:document'
              or exists (
                select 1
                from jsonb_array_elements(
                  case jsonb_typeof(attachment.storage_metadata->'assignments')
                    when 'array' then attachment.storage_metadata->'assignments'
                    when 'object' then jsonb_build_array(attachment.storage_metadata->'assignments')
                    else '[]'::jsonb
                  end
                ) as assignment
                where jsonb_typeof(assignment) = 'object'
                  and btrim(assignment->>'type') = 'documents:document'
              )
            )
        );
    `)
  }
}
